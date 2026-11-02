'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContentValidationError,
  extractInternalLinks,
  hasMeaningfulContent,
  plainTextFromHtml,
  sanitizeBlocks,
  sanitizeHtml,
  sanitizeHtmlWithReport,
  sanitizeUrl
} = require('../../server/content');

test('safe rich text keeps intended formatting, tables, lists, images and enumerated editor styles', () => {
  const input = '<h3 style="text-align:center;color:#fff;font-family:Georgia, serif">Title</h3>'
    + '<p><strong>bold</strong> <em>italic</em> <u>underlined</u> <s>struck</s></p>'
    + '<ul><li>one</li><li>two</li></ul>'
    + '<table><tbody><tr><th scope="col">Name</th><td colspan="2">Value</td></tr></tbody></table>'
    + '<p><img src="https://images.example.test/photo.png" alt="A synthetic image" width="320"></p>';
  const html = sanitizeHtml(input);

  assert.match(html, /<h3 style="text-align:center;color:#fff;font-family:Georgia, serif">Title<\/h3>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<u>underlined<\/u>/);
  assert.match(html, /<s>struck<\/s>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<table><tbody><tr><th scope="col">Name<\/th><td colspan="2">Value<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<img src="https:\/\/images\.example\.test\/photo\.png" alt="A synthetic image" width="320" \/>/);
  assert.equal(sanitizeHtmlWithReport('<strong style="color:#fff">Styled</strong>').formattingLoss.discarded, false);
});

test('legacy font formatting is deliberately converted and unsupported formatting is reported', () => {
  const legacy = '<font face="Georgia" size="5" color="#6644aa">Retained style</font>';
  const retained = sanitizeHtmlWithReport(legacy);
  assert.match(retained.html, /<span style="font-family:Georgia, serif;font-size:1\.5rem;color:#6644aa">Retained style<\/span>/);
  assert.equal(retained.formattingLoss.discarded, false);

  const losses = [];
  const unsafeLegacy = '<font face="Times New Roman" size="7" color="expression(alert(1))">Text</font>'
    + '<p class="old-layout" id="old" style="position:absolute;background-image:url(javascript:bad)">More</p>';
  const safe = sanitizeHtml(unsafeLegacy, { onFormattingLoss: (report) => losses.push(report) });
  assert.doesNotMatch(safe, /Times New Roman|expression|position|background-image|class=|id=/i);
  assert.equal(losses.length, 1);
  assert.equal(losses[0].discarded, true);
  assert.ok(losses[0].items.some((item) => item.name === 'font-family'));
  assert.ok(losses[0].items.some((item) => item.name === 'class'));
  assert.ok(losses[0].items.some((item) => item.name === 'position'));
});

test('active markup, foreign namespaces, event handlers and unsafe URL/CSS sinks are removed', () => {
  const input = '<script>alert(1)</script><style>body{display:none}</style>'
    + '<svg onload="alert(1)"><script>alert(2)</script><text>svg text</text></svg>'
    + '<math><mi>x</mi></math><iframe src="https://evil.example"></iframe>'
    + '<form action="https://evil.example"><input value="bad"></form>'
    + '<p onclick="alert(3)" onmouseover="alert(4)" style="color:red;position:fixed; background-image:url(https://evil.example/x)">Visible</p>'
    + '<a href="javascript:alert(5)" target="_blank" rel="opener">unsafe</a>'
    + '<a href="data:text/html,bad">unsafe data</a>'
    + '<img src="data:image/svg+xml,bad" onerror="alert(6)">';
  const html = sanitizeHtml(input);

  assert.doesNotMatch(html, /<script|<style|<svg|<math|<iframe|<form|<input|onload|onclick|onmouseover|onerror|javascript:|data:/i);
  assert.doesNotMatch(html, /position:|background-image:|class=|id=|srcdoc=/i);
  assert.match(html, /<p>Visible<\/p>/);
  assert.match(html, /<a>unsafe<\/a>/);
  assert.match(html, /<a>unsafe data<\/a>/);
});

test('safe URLs reject controls, encoded schemes, file/data URLs and protocol-relative destinations', () => {
  for (const value of [
    'javascript:alert(1)',
    'java%73cript:alert(1)',
    '%6a%61vascript%3Aalert(1)',
    'jav&#x61;script:alert(1)',
    'javascript&colon;alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    '//evil.example/path',
    '%2f%2fevil.example/path',
    'https://user:pass@example.test/path',
    'https:\\evil.example\\path',
    '/wiki/%0aheader',
    '/wiki/%252f%252fevil.example',
    '/wiki/with space'
  ]) assert.equal(sanitizeUrl(value), null, value);

  assert.equal(sanitizeUrl('https://example.test/wiki/a?x=1'), 'https://example.test/wiki/a?x=1');
  assert.equal(sanitizeUrl('http://example.test/wiki/a'), 'http://example.test/wiki/a');
  assert.equal(sanitizeUrl('https://example.test/wiki?q=100%25'), 'https://example.test/wiki?q=100%25');
  assert.equal(sanitizeUrl('/wiki/a'), '/wiki/a');
  assert.equal(sanitizeUrl('../wiki/a'), '../wiki/a');
  assert.equal(sanitizeUrl('#section-2'), '#section-2');
  assert.equal(sanitizeUrl('https://example.test/photo.png', { image: true }), 'https://example.test/photo.png');
  assert.equal(sanitizeUrl('http://example.test/photo.png', { image: true }), null);
  assert.equal(sanitizeUrl('/assets/logo.png', { image: true }), null);
  assert.equal(sanitizeUrl('/assets/logo.png', { image: true, allowedImagePaths: ['/assets/logo.png'] }), '/assets/logo.png');
  assert.equal(sanitizeUrl('/assets/other.png', { image: true, allowedImagePaths: ['/assets/logo.png'] }), null);
});

test('safe links receive rel protection and accepted HTML derives readable text and local links', () => {
  const safe = sanitizeHtml('<a href="https://example.test" target="_blank">external</a>'
    + '<a href="/wiki/mask">mask</a><a href="#section">section</a>'
    + '<p>São <strong>Paulo</strong> &amp; <em>lore</em></p><ul><li>first</li><li>second</li></ul>');
  assert.match(safe, /target="_blank" rel="noopener noreferrer"/);
  assert.deepEqual(extractInternalLinks(safe), ['/wiki/mask', '#section']);
  assert.match(plainTextFromHtml(safe), /São Paulo & lore/);
  assert.match(plainTextFromHtml(safe), /first/);
  assert.match(plainTextFromHtml(safe), /second/);
  assert.equal(plainTextFromHtml('<p>&#x1f30c; &eacute; &ldquo;quoted&rdquo;</p>'), '🌌 é “quoted”');
  assert.equal(hasMeaningfulContent('<p><br></p>'), false);
  assert.equal(hasMeaningfulContent('<p>  </p>'), false);
  assert.equal(hasMeaningfulContent('<p>\u200b\ufeff</p>'), false);
  assert.equal(hasMeaningfulContent('<img src="https://example.test/photo.png">'), true);
  assert.equal(hasMeaningfulContent('<img src="javascript:bad" alt="A synthetic diagram">'), true);
  assert.equal(hasMeaningfulContent('<img src="javascript:bad">'), false);
});

test('structured blocks validate all nine editor shapes and sanitize nested content and URLs', () => {
  const blocks = [
    { type: 'section', title: 'Section', content: '<p onclick="bad()">A <strong>safe</strong> section</p>' },
    { type: 'tabs', title: 'Tabs', items: [{ label: 'First', content: '<p><a href="javascript:bad">text</a></p>' }] },
    { type: 'gallery', title: 'Gallery', cols: '3', items: [{ url: 'https://example.test/a.png', caption: 'Synthetic' }] },
    { type: 'cards', title: 'Cards', items: [{ title: 'Card', badge: 'NPC', color: '#abc', image: '', desc: 'A card' }] },
    { type: 'quote', title: 'Quote', text: 'A synthetic quote', author: 'Example', avatar: '' },
    { type: 'stats', title: 'Stats', items: [{ label: 'Progress', value: 75, color: '#ffffff' }] },
    { type: 'accordion', title: 'Accordion', items: [{ title: 'Fold', content: '<p>Details</p>' }] },
    { type: 'timeline', title: 'Timeline', items: [{ date: 'Day 1', title: 'Event', desc: 'Description' }] },
    { type: 'datalist', title: 'Data', items: [{ label: 'Key', value: 'Value' }] }
  ];
  const safe = sanitizeBlocks(blocks);

  assert.equal(safe.length, 9);
  assert.match(safe[0].content, /<strong>safe<\/strong>/);
  assert.doesNotMatch(safe[0].content, /onclick=/);
  assert.equal(safe[1].items[0].content, '<p><a>text</a></p>');
  assert.equal(safe[2].cols, '3');
  assert.equal(safe[3].items[0].color, '#aabbcc');
  assert.equal(safe[5].items[0].value, 75);
  assert.equal(safe[6].items[0].content, '<p>Details</p>');
  assert.deepEqual(safe[8].items[0], { key: 'Key', val: 'Value' });
  const legacyLosses = [];
  sanitizeBlocks([{ type: 'section', content: '<p class="legacy">Text</p>' }], {
    onFormattingLoss: (report) => legacyLosses.push(report)
  });
  assert.equal(legacyLosses[0].path, 'blocks[0].content');
  assert.deepEqual(sanitizeBlocks([{ type: 'datalist', items: [{ key: 'Legacy key', val: 'Legacy value' }] }])[0].items[0], {
    key: 'Legacy key',
    val: 'Legacy value'
  });
});

test('structured blocks reject unknown fields/types, recursion, invalid URLs/colors and excessive items', () => {
  assert.throws(() => sanitizeBlocks([{ type: 'section', content: '<p>x</p>', blocks: [] }]), ContentValidationError);
  assert.throws(() => sanitizeBlocks([{ type: 'image' }]), /Unknown block type/);
  assert.throws(() => sanitizeBlocks([{ type: 'tabs', items: [{ label: 'x', content: '', blocks: [] }] }]), /Unknown field/);
  assert.throws(() => sanitizeBlocks([{ type: 'datalist', items: [{ label: 'incomplete' }] }]), /label\/value or key\/val/);
  assert.throws(() => sanitizeBlocks([{ type: 'datalist', items: [{ label: 'a', value: 'b', key: 'c', val: 'd' }] }]), /label\/value or key\/val/);
  assert.throws(() => sanitizeBlocks([{ type: 'gallery', items: [{ url: 'javascript:bad' }] }]), /Invalid image URL/);
  assert.throws(() => sanitizeBlocks([{ type: 'cards', items: [{ color: 'red' }] }]), /Invalid color/);
  assert.throws(() => sanitizeBlocks([{ type: 'stats', items: [{ value: 101 }] }]), /integer from 0 to 100/);
  assert.throws(() => sanitizeBlocks(Array.from({ length: 41 }, () => ({ type: 'section' }))), /at most 40 blocks/);
  assert.throws(() => sanitizeBlocks([{ type: 'datalist', items: Array.from({ length: 31 }, () => ({})) }]), /at most 30 items/);
  const largeSection = '<p>x</p>'.repeat(30_000);
  assert.throws(() => sanitizeBlocks([
    { type: 'section', content: largeSection },
    { type: 'section', content: largeSection },
    { type: 'section', content: largeSection }
  ]), /Combined block HTML/);
});

test('HTML and option limits fail clearly instead of truncating', () => {
  assert.throws(() => sanitizeHtml('é'.repeat(250_001)), /allowed size/);
  assert.throws(() => sanitizeHtml('<p>x</p>', { maxBytes: 0 }), /maxBytes/);
  assert.throws(() => sanitizeHtml('<p>x</p>', { allowedTags: ['script'] }), /unknown sanitize option/);
  assert.throws(() => sanitizeBlocks({}), ContentValidationError);
});
