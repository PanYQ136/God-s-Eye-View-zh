@echo off
chcp 65001 >nul
title God's Eye View PROD server (external)
setlocal
REM Production preview server: serves the built dist/ AND all /api providers
REM (every provider implements configurePreviewServer). Same proxy env as dev so
REM server-side upstream fetches + NO_PROXY direct-bypass behave identically.
set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=localhost,127.0.0.1,::1,.adsb.lol,adsb.lol,api.adsb.lol,.adsb.fi,adsb.fi,.airplanes.live,airplanes.live,pocketworld.org,.pocketworld.org,.nhc.noaa.gov,nhc.noaa.gov,www.nhc.noaa.gov,mapservices.weather.noaa.gov,earthquake.usgs.gov,.usgs.gov,eonet.gsfc.nasa.gov,.gsfc.nasa.gov,celestrak.org,.celestrak.org,data.livetraffic.com,firms.modaps.eosdis.nasa.gov,its.txdot.gov,nowcoast.noaa.gov,data.austintexas.gov,weathercam.digitraffic.fi,webcams.transport.nsw.gov.au,wvs.earthdata.nasa.gov,trafficcam.calgary.ca,api.tfl.gov.uk,tie.digitraffic.fi,video.deldot.gov,inciweb.wildfire.gov,.inciweb.wildfire.gov,tmc.deldot.gov,.tmc.deldot.gov"
set "PATH=C:\Users\13680\AppData\Local\hermes\tools\node-26.7.0-win32-x64;%PATH%"
set "GEV_ALLOWED_HOSTS=frp-fly.com"
cd /d D:\Hermes\gods-eye-view
echo [start-prod] %date% %time% NO_PROXY_len=%NO_PROXY% >> prod.log 2>&1
REM --host 0.0.0.0: reachable on localhost + LAN (192.168.110.x) + Tailscale (100.x)
node "node_modules\vite\bin\vite.js" preview --host 0.0.0.0 --port 4174 --strictPort >> prod.log 2>&1
endlocal
