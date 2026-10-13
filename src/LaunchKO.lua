#@ SimpleGraphic
-- Path of Building
--
-- Module: LaunchKO
-- Korean language pack entry point. Installs the translation layer, then hands over to Launch.lua.
-- Start with: "Path of Building.exe" src\LaunchKO.lua
--

LoadModule("Language/ko/Init")
LoadModule("Launch")
ko.AttachLaunch(launch)
