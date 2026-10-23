// 小程序端调用助手：把 godsEyeProxy 云函数包成简单函数
// 前提：app.js 里已 wx.cloud.init({ env: '你的云开发环境ID', traceUser: true })
//
// 用法：
//   const { geoCli } = require('../../utils/geoCli');
//   const cyclones = await geoCli('cyclones');
//   const quakes   = await geoCli('cn/quakes');
//   const flights  = await geoCli('opensky', { bbox: '110,20,125,35' });
//   const typhoon  = await geoCli('cn/typhoon');
//   const traffic  = await geoCli('cn/traffic', { bbox: '110,20,125,35' });

function geoCli(name, query) {
  const path = '/api/' + String(name || '').replace(/^\/?(api\/)?/, '');
  return wx.cloud
    .callFunction({ name: 'godsEyeProxy', data: { path, query } })
    .then((res) => {
      const r = (res && res.result) || {};
      if (!r.ok) {
        const err = new Error(r.error || ('upstream status ' + r.status));
        err.status = r.status;
        err.hint = r.hint;
        throw err;
      }
      return r.data;
    });
}

module.exports = { geoCli };
