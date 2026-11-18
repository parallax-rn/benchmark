import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { configParity, latinLayout, nonLatinKeyboards, parseAdbDevices, readConfig, seenAtStart } from './lib/preflight.mjs';

test('adb devices: every listed device counts, the header and daemon lines do not', () => {
  assert.deepEqual(parseAdbDevices('List of devices attached\n\n'), []);
  assert.deepEqual(parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n'), []);
  assert.deepEqual(parseAdbDevices('List of devices attached\nemulator-5554\tdevice\nR5CT\tunauthorized\nemulator-5556\toffline\n'), ['emulator-5554', 'R5CT', 'emulator-5556']);
});

function config(root, name, { skill = 'parallax v1', settings = {}, servers = { parallax: { command: 'npx', args: ['-y', '@parallax-rn/mcp@0.1.0-beta.5'] } } } = {}) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'skills', 'parallax'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'parallax', 'SKILL.md'), skill);
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: servers }));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  return readConfig(dir);
}

test('config parity: hooks and the strict allow rule may differ, nothing else may', () => {
  const root = mkdtempSync(join(tmpdir(), 'r2-parity-'));
  const plain = config(root, 'plain');
  const window = config(root, 'window', { settings: { hooks: { SessionStart: [] }, permissions: { allow: ['mcp__parallax'] } } });
  assert.deepEqual(configParity({ plain, window }), []);

  const otherSkill = config(root, 'other-skill', { skill: 'parallax v2' });
  assert.match(configParity({ plain, otherSkill }).join('\n'), /skills differ/);

  const otherServer = config(root, 'other-server', { servers: { parallax: { command: 'npx', args: ['-y', '@parallax-rn/mcp@0.1.0-beta.11'] } } });
  assert.match(configParity({ plain, otherServer }).join('\n'), /MCP servers differ/);

  const model = config(root, 'model', { settings: { model: 'other' } });
  assert.match(configParity({ plain, model }).join('\n'), /settings other than hooks and permissions differ/);

  // R1's gap: a skillOverride that hides Parallax's skill, even when every arm has it
  const off = config(root, 'off', { settings: { skillOverrides: { parallax: 'off' } } });
  assert.match(configParity({ off }).join('\n'), /off: skillOverrides turns the parallax skill off/);
});

test('seenAtStart reads Claude Code init event from the harness transcript', () => {
  const line = o => JSON.stringify({ t: 1, line: JSON.stringify(o) });
  const text = [line({ type: 'rate_limit_event' }), line({ type: 'system', subtype: 'init', claude_code_version: '2.1.318', model: 'claude-sonnet-5-5', skills: ['verify', 'parallax'], mcp_servers: [{ name: 'parallax', status: 'connected' }] })].join('\n');
  assert.deepEqual(seenAtStart(text), { claudeCodeVersion: '2.1.318', model: 'claude-sonnet-5-5', skills: ['parallax', 'verify'], mcpServers: ['parallax:connected'] });
  assert.equal(seenAtStart(''), null);
});

test('the input source: only ABC or US lets a batch type', () => {
  assert.ok(latinLayout('com.apple.keylayout.ABC'));
  assert.ok(latinLayout('com.apple.keylayout.US'));
  assert.ok(!latinLayout('com.apple.keylayout.RussianWin'));
  assert.ok(!latinLayout(''));
});

test('the simulator keyboards: a Russian one stops the batch, English and emoji do not', () => {
  assert.deepEqual(nonLatinKeyboards(['en_US@sw=QWERTY;hw=Automatic', 'en_GB@sw=QWERTY;hw=Automatic', 'emoji@sw=Emoji']), []);
  assert.deepEqual(nonLatinKeyboards(['en_US@sw=QWERTY;hw=Automatic', 'ru_RU@sw=Russian;hw=Automatic', 'ru_RU@sw=Russian;hw=Automatic']), ['ru_RU@sw=Russian;hw=Automatic']);
});
