#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
if (process.env.KATARIBE_DIARIZATION_ARGS_FILE) {
  fs.appendFileSync(
    process.env.KATARIBE_DIARIZATION_ARGS_FILE,
    `${args.join('\n')}\n---\n`,
  );
}

const mode = process.env.KATARIBE_DIARIZATION_MODE ?? 'ok';

function writeTurns(count) {
  for (let index = 0; index < count; index += 1) {
    process.stdout.write(
      `${index}.000 -- ${index + 1}.000 speaker_${String(index).padStart(2, '0')}\n`,
    );
  }
}

function writeAlternatingTurns(count) {
  for (let index = 0; index < count; index += 1) {
    process.stdout.write(
      `${index}.000 -- ${index + 1}.000 speaker_${String(index % 2).padStart(2, '0')}\n`,
    );
  }
}

if (mode === 'fail') {
  process.stderr.write('synthetic failure\n');
  process.exit(2);
}
if (mode === 'empty') {
  process.exit(0);
}
if (mode === 'cancel') {
  process.stderr.write('progress 1.00%\n');
  setTimeout(() => undefined, 30000);
} else if (mode === 'many') {
  writeTurns(args.includes('--clustering.num-clusters=10') ? 10 : 11);
  process.stderr.write('progress 100.00%\n');
} else if (mode === 'many-fail-rerun') {
  if (args.includes('--clustering.num-clusters=10')) {
    process.stderr.write('synthetic rerun failure\n');
    process.exit(2);
  }
  writeTurns(11);
  process.stderr.write('progress 100.00%\n');
} else if (mode === 'long') {
  writeAlternatingTurns(3000);
  process.stderr.write('progress 100.00%\n');
} else if (mode === 'one') {
  writeTurns(1);
  process.stderr.write('progress 100.00%\n');
} else if (mode === 'confidence') {
  process.stderr.write('progress 100.00%\n');
  process.stdout.write(
    '0.000 -- 1.000 speaker_00 confidence=0.912\n1.000 -- 2.000 speaker_01 confidence=n/a\n',
  );
} else if (mode === 'many-cancel-rerun') {
  if (args.includes('--clustering.num-clusters=10')) {
    process.stderr.write('progress 1.00%\n');
    setTimeout(() => undefined, 30000);
  } else {
    writeTurns(11);
    process.stderr.write('progress 100.00%\n');
  }
} else {
  process.stderr.write('progress 50.00%\nprogress 100.00%\n');
  process.stdout.write(
    '0.000 -- 1.000 speaker_00\n1.000 -- 2.000 speaker_01\n2.000 -- 3.000 speaker_00\n',
  );
}
