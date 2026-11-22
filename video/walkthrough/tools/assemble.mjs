// Turns the variable-rate screencast frames into a constant 30 fps silent video.
//   node tools/assemble.mjs <scratch-dir> <out.mp4>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [dir, out] = process.argv.slice(2);
const { frames, t1 } = JSON.parse(readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const lines = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  const next = i + 1 < frames.length ? frames[i + 1].t : t1;
  lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(6)}`);
});
lines.push(`file 'frames/${frames.at(-1).file}'`);
const list = path.join(dir, 'frames.ffconcat');
writeFileSync(list, lines.join('\n'));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-vf', "crop=1920:'min(ih,1080)':0:0,pad=1920:1080:0:0:color=black,fps=30,format=yuv420p", '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`${out}: ${(t1 - frames[0].t).toFixed(1)} s`);
