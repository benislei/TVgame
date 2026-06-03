'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeEnvPath(value) {
  return String(value || '')
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean);
}

function executableNames(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.exe') || lower.endsWith('.bat')
    ? [name]
    : [name, `${name}.exe`, `${name}.bat`];
}

function findInPath(name, env, exists) {
  for (const directory of normalizeEnvPath(env.PATH || env.Path || env.path)) {
    for (const executable of executableNames(name)) {
      const candidate = path.join(directory, executable);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function normalizeEnvRoot(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return path.resolve(trimmed);
}

function findAndroidSdkRoot(env = process.env, exists = fs.existsSync) {
  const home = normalizeEnvRoot(env.USERPROFILE || env.HOME);
  const candidates = [
    normalizeEnvRoot(env.ANDROID_SDK_ROOT),
    normalizeEnvRoot(env.ANDROID_HOME),
    normalizeEnvRoot(env.LOCALAPPDATA) && path.join(normalizeEnvRoot(env.LOCALAPPDATA), 'Android', 'Sdk'),
    home && path.join(home, 'AppData', 'Local', 'Android', 'Sdk')
  ].filter(Boolean);

  for (const candidate of candidates) {
    const markers = [
      path.join(candidate, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'),
      path.join(candidate, 'platform-tools', 'adb.exe'),
      path.join(candidate, 'platforms', 'android-35', 'android.jar'),
      path.join(candidate, 'build-tools', '35.0.0', 'aapt2.exe')
    ];
    if (markers.some(marker => exists(marker))) return candidate;
  }

  return null;
}

function createAndroidPaths(projectRoot = path.resolve(__dirname, '..', '..'), env = process.env, exists = fs.existsSync) {
  const home = normalizeEnvRoot(env.USERPROFILE || env.HOME);
  const localAppData = normalizeEnvRoot(env.LOCALAPPDATA);
  const sdkRoot = findAndroidSdkRoot(env, exists)
    || normalizeEnvRoot(env.ANDROID_SDK_ROOT)
    || normalizeEnvRoot(env.ANDROID_HOME)
    || (localAppData ? path.join(localAppData, 'Android', 'Sdk') : '')
    || (home ? path.join(home, 'AppData', 'Local', 'Android', 'Sdk') : '');

  return {
    projectRoot,
    receiverRoot: path.join(projectRoot, 'android-tv-receiver'),
    sdkRoot,
    apk: path.join(projectRoot, 'android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  };
}

function findJavaTool(name, env, exists) {
  const javaHome = normalizeEnvRoot(env.JAVA_HOME);
  if (javaHome) {
    const candidate = path.join(javaHome, 'bin', `${name}.exe`);
    if (exists(candidate)) return candidate;
  }

  return findInPath(name, env, exists);
}

function checkFile(label, file, exists, missing) {
  const found = Boolean(file && exists(file));
  if (!found) missing.push(label);
  return { found, path: file || null };
}

function createAndroidBuildReport(options = {}) {
  const env = options.env || process.env;
  const exists = options.exists || fs.existsSync;
  const projectRoot = options.projectRoot || path.resolve(__dirname, '..', '..');
  const paths = createAndroidPaths(projectRoot, env, exists);
  const missing = [];

  const javaPath = findJavaTool('java', env, exists);
  const javacPath = findJavaTool('javac', env, exists);
  const java = checkFile('JDK java.exe', javaPath, exists, missing);
  const javac = checkFile('JDK javac.exe', javacPath, exists, missing);

  const sdkmanagerPath = paths.sdkRoot
    ? path.join(paths.sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat')
    : null;
  const adbPath = paths.sdkRoot
    ? path.join(paths.sdkRoot, 'platform-tools', 'adb.exe')
    : null;
  const androidJarPath = paths.sdkRoot
    ? path.join(paths.sdkRoot, 'platforms', 'android-35', 'android.jar')
    : null;
  const aapt2Path = paths.sdkRoot
    ? path.join(paths.sdkRoot, 'build-tools', '35.0.0', 'aapt2.exe')
    : null;
  const gradlewPath = path.join(paths.receiverRoot, 'gradlew.bat');

  const sdkRootFound = Boolean(paths.sdkRoot && (
    exists(paths.sdkRoot)
    || [sdkmanagerPath, adbPath, androidJarPath, aapt2Path].some(file => file && exists(file))
  ));
  if (!paths.sdkRoot || !sdkRootFound) missing.push('Android SDK root');

  const sdkmanager = checkFile('Android SDK sdkmanager.bat', sdkmanagerPath, exists, missing);
  const adb = checkFile('Android SDK platform-tools adb.exe', adbPath, exists, missing);
  const android35 = checkFile('Android SDK platform android-35', androidJarPath, exists, missing);
  const buildTools35 = checkFile('Android SDK build-tools 35.0.0', aapt2Path, exists, missing);
  const gradlew = checkFile('Gradle Wrapper gradlew.bat', gradlewPath, exists, missing);
  const apkFound = Boolean(paths.apk && exists(paths.apk));

  const jdkReady = java.found && javac.found;
  const sdkReady = sdkmanager.found && adb.found;
  const packagesReady = android35.found && buildTools35.found;
  const gradleWrapperReady = gradlew.found;

  return {
    ready: Boolean(jdkReady && sdkReady && packagesReady && gradleWrapperReady),
    paths,
    jdk: {
      ready: jdkReady,
      java,
      javac
    },
    sdk: {
      ready: sdkReady,
      root: paths.sdkRoot || null,
      sdkmanager,
      adb
    },
    packages: {
      ready: packagesReady,
      android35,
      buildTools35
    },
    gradleWrapper: {
      ready: gradleWrapperReady,
      path: gradlew.path
    },
    apk: {
      path: paths.apk,
      found: apkFound
    },
    missing
  };
}

module.exports = {
  createAndroidPaths,
  findAndroidSdkRoot,
  createAndroidBuildReport
};
