/* 清理遗留的 Phase6A 诊断 task space（每个都留了一个 Cesium 页面在吃 GPU） */
const spaces = await listTaskSpaces();
console.log(spaces.map((s) => `${s.id} | ${s.name} | ${s.ownership}`).join("\n"));
for (const s of spaces) {
  if (!/^gev-phase6a-(diag|timing|probe2|gate)$/.test(s.name || "")) continue;
  try {
    const t = await claimTaskSpace(s.id);
    await t.finish({ keep: [] });
    console.log("finished", s.id, s.name);
  } catch (e) {
    console.log("finish failed", s.id, String(e).slice(0, 160));
  }
}
