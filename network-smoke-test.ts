import { ApkgZip } from './src/lib/anki/ankilib.ts';
import { downloadVideos } from './src/lib/anki/mediaBundle.ts';
import { unzipSync } from 'fflate';

async function main() {
  const zip = new ApkgZip();
  let done = 0;
  const total = 3;
  const filenames = ['0.mp4', '1aar.mp4', 'monosakkarid'];
  const { failed, resolved, totalBytes } = await downloadVideos(filenames, zip, (d, t) => {
    done = d;
    if (t !== total) throw new Error('total wrong');
  });
  console.log('done:', done, 'failed:', [...failed], 'bytes:', totalBytes);
  console.log('resolved:', [...resolved.entries()]);
  if (failed.size !== 0) throw new Error('real downloads should succeed');
  if (done !== total) throw new Error('progress incomplete');
  if (!resolved.has('monosakkarid')) throw new Error('monosakkarid not resolved');

  const blob = await zip.finish(new Uint8Array([1]));
  const zipObj = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const mediaMap = JSON.parse(new TextDecoder().decode(zipObj['media']));
  console.log('media map:', JSON.stringify(mediaMap));

  const checkMp4 = (bytes: Uint8Array, label: string) => {
    const ftypAt = [bytes[4], bytes[5], bytes[6], bytes[7]].map((b) => String.fromCharCode(b)).join('');
    console.log(label, 'magic:', ftypAt, 'size:', bytes.length);
    if (ftypAt !== 'ftyp') throw new Error(`${label} is not an mp4`);
  };
  const idx0 = Object.keys(mediaMap).find((k) => mediaMap[k] === '0.mp4')!;
  const idx1 = Object.keys(mediaMap).find((k) => mediaMap[k] === '1aar.mp4')!;
  const idx2 = Object.keys(mediaMap).find((k) => mediaMap[k] === 'monosakkarid.mp4')!;
  checkMp4(zipObj[idx0], '0.mp4');
  checkMp4(zipObj[idx1], '1aar.mp4');
  checkMp4(zipObj[idx2], 'monosakkarid.mp4');
  console.log('real-network smoke test: PASS');
}

main().catch((e) => {
  console.error('real-network smoke test: FAIL', e);
  process.exit(1);
});
