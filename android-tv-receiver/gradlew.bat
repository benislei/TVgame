@echo off
chcp 65001 >NUL
setlocal

set APP_HOME=%~dp0
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar

if "%JAVA_HOME%"=="" goto usePathJava
set JAVA_EXE=%JAVA_HOME%\bin\java.exe
if exist "%JAVA_EXE%" goto runWrapper
echo 错误：JAVA_HOME 指向的位置没有 java.exe：%JAVA_EXE%
echo 请安装 JDK 17，或运行 npm.cmd run android:install。
exit /b 1

:usePathJava
set JAVA_EXE=java.exe

:runWrapper
"%JAVA_EXE%" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
