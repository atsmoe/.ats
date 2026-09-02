const test = require('node:test');
const assert = require('node:assert/strict');

const { parseWikitextMedia } = require('../scripts/lib/ff14-wikitext-media.js');

test('FFXIV wikitext media keeps heading ancestry and source order', () => {
  const wikitext = `== 红莲之狂潮 ==
[[文件:巴埃萨长城.jpg|thumb|right|300px|跨越长城]]
=== 跨越长城 ===
正文。
[[File:神龙与芝诺斯.jpg|left|300px]]
=== 红莲之狂潮 ===
[[文件:阿拉米格王宫.png|center|决战之地]]`;
  const outerHeadingPosition = wikitext.indexOf('== 红莲之狂潮 ==');
  const crossingHeadingPosition = wikitext.indexOf('=== 跨越长城 ===');
  const innerHeadingPosition = wikitext.indexOf('=== 红莲之狂潮 ===');

  assert.deepEqual(parseWikitextMedia(wikitext), [
    {
      sectionPath: ['红莲之狂潮'],
      sectionTrail: [
        { title: '红莲之狂潮', level: 2, position: outerHeadingPosition },
      ],
      position: wikitext.indexOf('[[文件:巴埃萨长城.jpg'),
      fileTitle: '巴埃萨长城.jpg',
      caption: '跨越长城',
      ordinal: 1,
      rawTag: '[[文件:巴埃萨长城.jpg|thumb|right|300px|跨越长城]]',
    },
    {
      sectionPath: ['红莲之狂潮', '跨越长城'],
      sectionTrail: [
        { title: '红莲之狂潮', level: 2, position: outerHeadingPosition },
        { title: '跨越长城', level: 3, position: crossingHeadingPosition },
      ],
      position: wikitext.indexOf('[[File:神龙与芝诺斯.jpg'),
      fileTitle: '神龙与芝诺斯.jpg',
      caption: null,
      ordinal: 2,
      rawTag: '[[File:神龙与芝诺斯.jpg|left|300px]]',
    },
    {
      sectionPath: ['红莲之狂潮', '红莲之狂潮'],
      sectionTrail: [
        { title: '红莲之狂潮', level: 2, position: outerHeadingPosition },
        { title: '红莲之狂潮', level: 3, position: innerHeadingPosition },
      ],
      position: wikitext.indexOf('[[文件:阿拉米格王宫.png'),
      fileTitle: '阿拉米格王宫.png',
      caption: '决战之地',
      ordinal: 3,
      rawTag: '[[文件:阿拉米格王宫.png|center|决战之地]]',
    },
  ]);
});

test('gallery entries join the same document-order media stream', () => {
  const wikitext = `== 红莲之狂潮 ==
=== 远东之国 ===
<gallery widths="240" heights="135">
File:红玉海航路.jpg|红玉海航路
 文件:多玛城.png | alt=多玛城远景 | 多玛城解放战
</gallery>`;
  const sectionTrail = [
    { title: '红莲之狂潮', level: 2, position: wikitext.indexOf('== 红莲之狂潮 ==') },
    { title: '远东之国', level: 3, position: wikitext.indexOf('=== 远东之国 ===') },
  ];

  assert.deepEqual(parseWikitextMedia(wikitext), [
    {
      sectionPath: ['红莲之狂潮', '远东之国'],
      sectionTrail,
      position: wikitext.indexOf('File:红玉海航路.jpg'),
      fileTitle: '红玉海航路.jpg',
      caption: '红玉海航路',
      ordinal: 1,
      rawTag: 'File:红玉海航路.jpg|红玉海航路',
    },
    {
      sectionPath: ['红莲之狂潮', '远东之国'],
      sectionTrail,
      position: wikitext.indexOf('文件:多玛城.png'),
      fileTitle: '多玛城.png',
      caption: '多玛城解放战',
      ordinal: 2,
      rawTag: '文件:多玛城.png | alt=多玛城远景 | 多玛城解放战',
    },
  ]);
});

test('template fields are ignored while explicit media tags remain discoverable', () => {
  const wikitext = `== 红莲之狂潮 ==
{{剧情信息框
|image=信息框封面.jpg
|题图=[[File:模板题图.png|thumb|信息框题图]]
|画廊=<gallery>
文件:模板画廊.jpg|信息框附图
</gallery>
}}
<!-- [[文件:注释示例.png|thumb|不应采集]] -->
<nowiki>[[File:语法示例.png|left]]</nowiki>
[[文件:真实事件图.jpg|thumb|right|战火中的{{color|red|阿拉米格}}]]`;
  const sectionTrail = [
    { title: '红莲之狂潮', level: 2, position: wikitext.indexOf('== 红莲之狂潮 ==') },
  ];

  assert.deepEqual(parseWikitextMedia(wikitext), [
    {
      sectionPath: ['红莲之狂潮'],
      sectionTrail,
      position: wikitext.indexOf('[[File:模板题图.png'),
      fileTitle: '模板题图.png',
      caption: '信息框题图',
      ordinal: 1,
      rawTag: '[[File:模板题图.png|thumb|信息框题图]]',
    },
    {
      sectionPath: ['红莲之狂潮'],
      sectionTrail,
      position: wikitext.indexOf('文件:模板画廊.jpg'),
      fileTitle: '模板画廊.jpg',
      caption: '信息框附图',
      ordinal: 2,
      rawTag: '文件:模板画廊.jpg|信息框附图',
    },
    {
      sectionPath: ['红莲之狂潮'],
      sectionTrail,
      position: wikitext.indexOf('[[文件:真实事件图.jpg'),
      fileTitle: '真实事件图.jpg',
      caption: '战火中的{{color|red|阿拉米格}}',
      ordinal: 3,
      rawTag: '[[文件:真实事件图.jpg|thumb|right|战火中的{{color|red|阿拉米格}}]]',
    },
  ]);
});

test('output is deterministic, JSON-safe, and preserves nested caption markup', () => {
  const wikitext = '[[File:序章.png|thumb|[[阿拉米格|王都]]的远景]]';
  const first = parseWikitextMedia(wikitext);
  const second = parseWikitextMedia(wikitext);

  assert.deepEqual(first, [
    {
      sectionPath: [],
      sectionTrail: [],
      position: 0,
      fileTitle: '序章.png',
      caption: '[[阿拉米格|王都]]的远景',
      ordinal: 1,
      rawTag: wikitext,
    },
  ]);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.throws(
    () => parseWikitextMedia(Buffer.from(wikitext)),
    /requires a wikitext string/u,
  );
});
