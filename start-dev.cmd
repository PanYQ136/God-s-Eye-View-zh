@echo off
chcp 65001 >nul
title God's Eye View dev server
setlocal
REM NODE_USE_ENV_PROXY is read by Node at PROCESS START, so the proxy env must
REM be present here — setting it at runtime inside vite.config/local-proxy.mjs
REM is too late for undici's global fetch (adsbdb/OpenSky/etc. would fail in CN).
set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=localhost,127.0.0.1,::1,.adsb.lol,adsb.lol,api.adsb.lol,.adsb.fi,adsb.fi,.airplanes.live,airplanes.live,pocketworld.org,.pocketworld.org,.nhc.noaa.gov,nhc.noaa.gov,www.nhc.noaa.gov,mapservices.weather.noaa.gov,earthquake.usgs.gov,.usgs.gov,eonet.gsfc.nasa.gov,.gsfc.nasa.gov,celestrak.org,.celestrak.org,data.livetraffic.com,firms.modaps.eosdis.nasa.gov,its.txdot.gov,nowcoast.noaa.gov,data.austintexas.gov,weathercam.digitraffic.fi,webcams.transport.nsw.gov.au,wvs.earthdata.nasa.gov,trafficcam.calgary.ca,api.tfl.gov.uk,tie.digitraffic.fi,video.deldot.gov,inciweb.wildfire.gov,.inciweb.wildfire.gov,tmc.deldot.gov,.tmc.deldot.gov"
set "PATH=C:\Users\13680\AppData\Local\hermes\tools\node-26.7.0-win32-x64;%PATH%"
cd /d D:\Hermes\gods-eye-view
echo [start-dev] HOST=%HOST% PORT=%PORT% NO_PROXY=%NO_PROXY% >> dev_proxy.log
REM --host 0.0.0.0: listen on localhost + LAN + Tailscale so the phone (100.x) can reach it
node "node_modules\vite\bin\vite.js" --host 0.0.0.0 --port 4173 >> dev_proxy.log 2>&1
endlocal
