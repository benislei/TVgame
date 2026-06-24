'use strict';

const QUALITY_PRESETS = [
  {
    id: 'h264720p30',
    label: '720P30',
    profile: 'h264720p30',
    codec: 'H.264',
    description: '稳定优先，适合电视盒子和弱解码设备'
  },
  {
    id: 'h264720p60',
    label: '720P60',
    profile: 'h264720p60',
    codec: 'H.264',
    description: '流畅优先，适合网络稳定但解码一般的设备'
  },
  {
    id: 'h2641080p30',
    label: '1080P30',
    profile: 'h2641080p30',
    codec: 'H.264',
    description: '清晰稳定，适合电视盒子优先尝试'
  },
  {
    id: 'h2641080p60',
    label: '1080P60',
    profile: 'h2641080p60',
    codec: 'H.264',
    description: '高性能，适合手机、高性能电视或盒子'
  },
  {
    id: 'hevc1080p30',
    label: 'HEVC 1080P30',
    profile: 'hevc1080p30',
    codec: 'HEVC',
    description: '推荐，低码率高清，优先使用',
    recommended: true
  },
  {
    id: 'hevc1080p60',
    label: 'HEVC 1080P60',
    profile: 'hevc1080p60',
    codec: 'HEVC',
    description: '高性能，适合解码能力较强的 Android 11+ 设备'
  }
];

function getQualityPreset(id) {
  return QUALITY_PRESETS.find(preset => preset.id === id) || null;
}

module.exports = {
  QUALITY_PRESETS,
  getQualityPreset
};
