import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/chat-format.js', import.meta.url), 'utf8');

function fixture() {
  const document = {
    createTextNode(value) { return { nodeType: 3, textContent: value }; },
    createElement(tagName) {
      assert.ok(['p', 'strong', 'a'].includes(tagName), `Unexpected element: ${tagName}`);
      return {
        nodeType: 1, tagName, ownerDocument: document, children: [], attributes: {},
        appendChild(node) { this.children.push(node); return node; },
        setAttribute(name, value) { this.attributes[name] = value; },
        get textContent() { return this.children.map(node => node.textContent).join(''); },
        set innerHTML(_value) { throw new Error('HTML parsing is forbidden'); },
      };
    },
  };
  const window = {};
  vm.runInNewContext(source, { document, window, URL });
  const container = document.createElement('p');
  return { container, append: text => window.JaeChatText.append(container, text) };
}

test('inline bold and approved profile links become strong/anchor nodes without losing surrounding text', () => {
  const { container, append } = fixture();
  append('논문은 **심사 중**이에요. [연구 섹션](https://jaeyeong2026.com/#research)\n더 알아보세요.');
  assert.equal(container.textContent, '논문은 심사 중이에요. 연구 섹션\n더 알아보세요.');
  const elements = container.children.filter(node => node.nodeType === 1);
  assert.deepEqual(elements.map(node => node.tagName), ['strong', 'a']);
  assert.equal(elements[0].textContent, '심사 중');
  assert.deepEqual(elements[1].attributes, {
    href: 'https://jaeyeong2026.com/#research', target: '_blank', rel: 'noopener noreferrer',
  });
});

test('raw HTML and HTML-shaped labels remain inert text even inside supported formatting', () => {
  const { container, append } = fixture();
  const raw = '<script>alert(1)</script><img src=x onerror="alert(1)">';
  append(`${raw} **<svg onload=alert(1)>** [<img src=x onerror="alert(1)">](https://github.com/Jaeyeong-CHOI)`);
  assert.ok(container.textContent.startsWith(raw));
  const elements = container.children.filter(node => node.nodeType === 1);
  assert.deepEqual(elements.map(node => node.tagName), ['strong', 'a']);
  for (const element of elements) assert.ok(element.children.every(node => node.nodeType === 3));
  assert.equal(elements[1].textContent, '<img src=x onerror="alert(1)">');
  assert.equal(Object.hasOwn(elements[1].attributes, 'onerror'), false);
});

test('unsafe, unknown, credentialed and malformed link targets stay entirely literal', () => {
  const unsafe = [
    'javascript:alert%281%29', 'data:text/html,evil', '//jaeyeong2026.com/',
    'http://jaeyeong2026.com/', 'https://evil.example/',
    'https://jaeyeong2026.com.evil.example/', 'https://evil.jaeyeong2026.com/',
    'https://jaeyeong2026.com@evil.example/', 'https://evil@jaeyeong2026.com/',
    'https://jaeyeong2026.com:8080/', 'https://jaeyeong2026.com\\@evil.example/',
    'https://jaeyeong2026.com\u0000.evil.example/', 'https://[broken',
    'mailto:somebody@example.com', 'mailto:jaeyeong2022@gmail.com?bcc=evil@example.com',
  ];
  for (const url of unsafe) {
    const { container, append } = fixture();
    const text = `before [label](${url}) after`;
    append(text);
    assert.equal(container.textContent, text, url);
    assert.ok(container.children.every(node => node.nodeType === 3), url);
  }
});

test('all approved destinations and only the exact public mail address are linked safely', () => {
  const allowed = [
    'https://jaeyeong2026.com/#research', 'https://www.jaeyeong2026.com/',
    'https://ksa.dli-lecture.com/', 'https://github.com/Jaeyeong-CHOI',
    'https://www.linkedin.com/in/jaeychoi2022/', 'https://www.youtube.com/watch?v=p3PtTydcsD8',
    'mailto:jaeyeong2022@gmail.com',
  ];
  for (const url of allowed) {
    const { container, append } = fixture();
    append(`[Public profile](${url})`);
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].tagName, 'a');
    assert.equal(container.children[0].attributes.href, url);
  }
});

test('unmatched syntax and plain text are preserved and append does not replace earlier content', () => {
  const { container, append } = fixture();
  const plain = 'Hello\n**unfinished [missing](broken target) <b>literal</b> & "quotes"';
  append('Earlier. ');
  append(plain);
  assert.equal(container.textContent, 'Earlier. ' + plain);
  assert.ok(container.children.every(node => node.nodeType === 3));
});
