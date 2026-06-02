#!/usr/bin/env python3
"""
GStreamer WebRTC NVENC sender for TVGame.

This script is the native sending path target:
  D3D11 screen capture -> NVENC H.264 -> RTP -> webrtcbin -> browser receiver

It is intentionally kept separate from the browser sender. The current receiver
and signaling server already understand offer/answer/candidate messages.
"""

import argparse
import asyncio
import json
import ssl
import sys

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import Gst, GstWebRTC, GstSdp  # noqa: E402

try:
    import websockets
except ImportError:
    print("缺少 Python websockets 模块。请运行：python -m pip install websockets", file=sys.stderr)
    raise


PROFILES = {
    "720p60": {"width": 1280, "height": 720, "fps": 60, "bitrate": 12000, "gop": 60},
    "1080p60": {"width": 1920, "height": 1080, "fps": 60, "bitrate": 25000, "gop": 60},
    "1440p60": {"width": 2560, "height": 1440, "fps": 60, "bitrate": 45000, "gop": 60},
    "4k60": {"width": 3840, "height": 2160, "fps": 60, "bitrate": 80000, "gop": 60},
}


def build_pipeline(profile, display):
    fps = profile["fps"]
    width = profile["width"]
    height = profile["height"]
    bitrate = profile["bitrate"]
    gop = profile["gop"]
    return (
        "webrtcbin name=webrtc bundle-policy=max-bundle latency=0 "
        f"d3d11screencapturesrc show-cursor=true monitor-index={display} ! "
        f"video/x-raw(memory:D3D11Memory),framerate={fps}/1 ! "
        "d3d11convert ! "
        f"video/x-raw(memory:D3D11Memory),format=NV12,width={width},height={height},framerate={fps}/1 ! "
        f"nvh264enc preset=low-latency-hq rc-mode=cbr bitrate={bitrate} gop-size={gop} "
        "bframes=0 zero-reorder-delay=true ! "
        "h264parse config-interval=-1 ! "
        "rtph264pay pt=96 config-interval=-1 aggregate-mode=zero-latency ! "
        "application/x-rtp,media=video,encoding-name=H264,payload=96 ! "
        "webrtc."
    )


class NativeSender:
    def __init__(self, args):
        self.args = args
        self.ws = None
        self.pipeline = None
        self.webrtc = None
        self.loop = None

    async def send(self, payload):
        await self.ws.send(json.dumps(payload))

    def start_pipeline(self):
        Gst.init(None)
        profile = PROFILES[self.args.profile]
        description = build_pipeline(profile, self.args.display)
        print("启动 GStreamer 管线：")
        print(description)
        self.pipeline = Gst.parse_launch(description)
        self.webrtc = self.pipeline.get_by_name("webrtc")
        self.webrtc.connect("on-negotiation-needed", self.on_negotiation_needed)
        self.webrtc.connect("on-ice-candidate", self.on_ice_candidate)
        self.pipeline.set_state(Gst.State.PLAYING)

    def on_negotiation_needed(self, element):
        promise = Gst.Promise.new_with_change_func(self.on_offer_created, element, None)
        element.emit("create-offer", None, promise)

    def on_offer_created(self, promise, element, _):
        promise.wait()
        reply = promise.get_reply()
        offer = reply.get_value("offer")
        element.emit("set-local-description", offer, Gst.Promise.new())
        asyncio.run_coroutine_threadsafe(
            self.send({
                "type": "offer",
                "description": {
                    "type": "offer",
                    "sdp": offer.sdp.as_text(),
                },
            }),
            self.loop,
        )

    def on_ice_candidate(self, _element, mlineindex, candidate):
        asyncio.run_coroutine_threadsafe(
            self.send({
                "type": "candidate",
                "candidate": {
                    "candidate": candidate,
                    "sdpMLineIndex": mlineindex,
                    "sdpMid": "video0",
                },
            }),
            self.loop,
        )

    def apply_answer(self, sdp_text):
        res, sdp = GstSdp.SDPMessage.new()
        if res != GstSdp.SDPResult.OK:
            raise RuntimeError("创建 SDPMessage 失败")
        res = GstSdp.sdp_message_parse_buffer(bytes(sdp_text.encode()), sdp)
        if res != GstSdp.SDPResult.OK:
            raise RuntimeError("解析 answer SDP 失败")
        answer = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.ANSWER, sdp)
        self.webrtc.emit("set-remote-description", answer, Gst.Promise.new())

    def add_candidate(self, candidate):
        if not candidate:
            return
        mline = candidate.get("sdpMLineIndex", 0)
        text = candidate.get("candidate")
        if text:
            self.webrtc.emit("add-ice-candidate", mline, text)

    async def run(self):
        self.loop = asyncio.get_running_loop()
        ssl_context = ssl.create_default_context() if self.args.signal.startswith("wss://") else None
        async with websockets.connect(self.args.signal, ssl=ssl_context) as ws:
            self.ws = ws
            await self.send({"type": "join", "room": self.args.room, "role": "native-sender"})
            self.start_pipeline()
            async for raw in ws:
                message = json.loads(raw)
                if message.get("type") == "answer":
                    description = message.get("description") or message.get("sdp") or {}
                    self.apply_answer(description.get("sdp", ""))
                elif message.get("type") == "candidate":
                    self.add_candidate(message.get("candidate"))


def parse_args():
    parser = argparse.ArgumentParser(description="电视游戏原生 NVENC 发送端")
    parser.add_argument("--signal", default="ws://127.0.0.1:8080")
    parser.add_argument("--room", default="game")
    parser.add_argument("--profile", default="1080p60", choices=PROFILES.keys())
    parser.add_argument("--display", default=0, type=int)
    return parser.parse_args()


if __name__ == "__main__":
    sender = NativeSender(parse_args())
    try:
        asyncio.run(sender.run())
    finally:
        if sender.pipeline:
            sender.pipeline.set_state(Gst.State.NULL)
