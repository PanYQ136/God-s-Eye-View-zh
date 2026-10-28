import sharp from 'sharp';
const f = process.argv[2];
const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => { const i = (Math.round(y) * info.width + Math.round(x)) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
const rows = {};
for (const [tag, y] of [['y94', 94], ['y190', 190], ['y200', 200]]) {
  rows[tag] = [at(120, y * 2), at(200, y * 2), at(300, y * 2)];
}
console.log(JSON.stringify({ size: [info.width, info.height], rows }));
await sharp(f).extract({ left: 60, top: 150, width: 520, height: 340 }).resize({ width: 1040 }).toFile(process.argv[3]);
