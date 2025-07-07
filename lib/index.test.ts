import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { Readable } from 'stream';
import { MarkupTokenizer } from './index.js';

type Token = [string, Buffer];

const tokenize = (input: string): Promise<Token[]> =>
  new Promise((resolve, reject) => {
    const tokens: Token[] = [];
    const tokenizer = new MarkupTokenizer();
    
    tokenizer.on('data', (token: Token) => {
      tokens.push(token);
    });
    
    tokenizer.on('end', () => {
      resolve(tokens);
    });
    
    tokenizer.on('error', reject);
    
    const readable = Readable.from([Buffer.from(input, 'utf8')]);
    readable.pipe(tokenizer);
  });

const tokenizeStreaming = (chunks: string[]): Promise<Token[]> =>
  new Promise((resolve, reject) => {
    const tokens: Token[] = [];
    const tokenizer = new MarkupTokenizer();
    
    tokenizer.on('data', (token: Token) => {
      tokens.push(token);
    });
    
    tokenizer.on('end', () => {
      resolve(tokens);
    });
    
    tokenizer.on('error', reject);
    
    const readable = Readable.from(chunks.map(chunk => Buffer.from(chunk, 'utf8')));
    readable.pipe(tokenizer);
  });

const bufferToString = (buffer: Buffer): string => buffer.toString('utf8');

describe('MarkupTokenizer', () => {
  
  test('simple text', async () => {
    const tokens = await tokenize('hello world');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0][0], 'text');
    assert.equal(bufferToString(tokens[0][1]), 'hello world');
  });

  test('simple tag', async () => {
    const tokens = await tokenize('<div>hello</div>');
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0][0], 'open');
    assert.equal(bufferToString(tokens[0][1]), '<div>');
    assert.equal(tokens[1][0], 'text');
    assert.equal(bufferToString(tokens[1][1]), 'hello');
    assert.equal(tokens[2][0], 'close');
    assert.equal(bufferToString(tokens[2][1]), '</div>');
  });

  test('self-closing tag', async () => {
    const tokens = await tokenize('<img src="test.jpg"/>');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0][0], 'open');
    assert.equal(bufferToString(tokens[0][1]), '<img src="test.jpg"/>');
  });

  test('tag with attributes', async () => {
    const tokens = await tokenize('<div class="container" id="main">content</div>');
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0][0], 'open');
    assert.equal(bufferToString(tokens[0][1]), '<div class="container" id="main">');
    assert.equal(tokens[1][0], 'text');
    assert.equal(bufferToString(tokens[1][1]), 'content');
    assert.equal(tokens[2][0], 'close');
    assert.equal(bufferToString(tokens[2][1]), '</div>');
  });

  test('nested tags', async () => {
    const tokens = await tokenize('<div><span>hello</span></div>');
    assert.equal(tokens.length, 5);
    assert.equal(tokens[0][0], 'open');
    assert.equal(bufferToString(tokens[0][1]), '<div>');
    assert.equal(tokens[1][0], 'open');
    assert.equal(bufferToString(tokens[1][1]), '<span>');
    assert.equal(tokens[2][0], 'text');
    assert.equal(bufferToString(tokens[2][1]), 'hello');
    assert.equal(tokens[3][0], 'close');
    assert.equal(bufferToString(tokens[3][1]), '</span>');
    assert.equal(tokens[4][0], 'close');
    assert.equal(bufferToString(tokens[4][1]), '</div>');
  });

  describe('Comments', () => {
    test('simple comment', async () => {
      const tokens = await tokenize('<!-- hello -->');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<!--');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), ' hello ');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '-->');
    });

    test('comment with markup inside', async () => {
      const tokens = await tokenize('<!-- <div>test</div> -->');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<!--');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), ' <div>test</div> ');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '-->');
    });

    test('comment with loose angle brackets', async () => {
      const tokens = await tokenize('<!-- < > < test > -->');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<!--');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), ' < > < test > ');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '-->');
    });

    test('multiple comments', async () => {
      const tokens = await tokenize('<!-- first -->text<!-- second -->');
      assert.equal(tokens.length, 7);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<!--');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), ' first ');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '-->');
      assert.equal(tokens[3][0], 'text');
      assert.equal(bufferToString(tokens[3][1]), 'text');
      assert.equal(tokens[4][0], 'open');
      assert.equal(bufferToString(tokens[4][1]), '<!--');
      assert.equal(tokens[5][0], 'text');
      assert.equal(bufferToString(tokens[5][1]), ' second ');
      assert.equal(tokens[6][0], 'close');
      assert.equal(bufferToString(tokens[6][1]), '-->');
    });
  });


  describe('Script tags', () => {
    test('simple script', async () => {
      const tokens = await tokenize('<script>alert("hello");</script>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<script>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'alert("hello");');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</script>');
    });

    test('script with markup inside', async () => {
      const tokens = await tokenize('<script>var html = "<div>test</div>";</script>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<script>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'var html = "<div>test</div>";');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</script>');
    });

    test('script with attributes', async () => {
      const tokens = await tokenize('<script type="text/javascript">console.log("test");</script>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<script type="text/javascript">');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'console.log("test");');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</script>');
    });
  });

  describe('Style tags', () => {
    test('simple style', async () => {
      const tokens = await tokenize('<style>body { color: red; }</style>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<style>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'body { color: red; }');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</style>');
    });

    test('style with CSS selectors', async () => {
      const tokens = await tokenize('<style>.class > div { margin: 0; }</style>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<style>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), '.class > div { margin: 0; }');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</style>');
    });
  });

  describe('Title tags', () => {
    test('simple title', async () => {
      const tokens = await tokenize('<title>Page Title</title>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<title>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'Page Title');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</title>');
    });

    test('title with special characters', async () => {
      const tokens = await tokenize('<title>Test & Title < > "quotes"</title>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<title>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'Test & Title < > "quotes"');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</title>');
    });
  });

  describe('Attributes and quotes', () => {
    test('double quoted attributes', async () => {
      const tokens = await tokenize('<div class="test" id="main">content</div>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class="test" id="main">');
    });

    test('single quoted attributes', async () => {
      const tokens = await tokenize("<div class='test' id='main'>content</div>");
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), "<div class='test' id='main'>");
    });

    test('unquoted attributes', async () => {
      const tokens = await tokenize('<div class=test id=main>content</div>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class=test id=main>');
    });

    test('mixed quote styles', async () => {
      const tokens = await tokenize('<div class="test" id=\'main\' data-value=unquoted>content</div>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class="test" id=\'main\' data-value=unquoted>');
    });

    test('attributes with special characters', async () => {
      const tokens = await tokenize('<div data-test="value with spaces" onclick="alert(\\"hello\\")">content</div>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div data-test="value with spaces" onclick="alert(\\"hello\\")">');
    });
  });

  describe('Table elements', () => {
    test('simple table', async () => {
      const tokens = await tokenize('<table><tr><td>cell</td></tr></table>');
      assert.equal(tokens.length, 7);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<table>');
      assert.equal(tokens[1][0], 'open');
      assert.equal(bufferToString(tokens[1][1]), '<tr>');
      assert.equal(tokens[2][0], 'open');
      assert.equal(bufferToString(tokens[2][1]), '<td>');
      assert.equal(tokens[3][0], 'text');
      assert.equal(bufferToString(tokens[3][1]), 'cell');
      assert.equal(tokens[4][0], 'close');
      assert.equal(bufferToString(tokens[4][1]), '</td>');
      assert.equal(tokens[5][0], 'close');
      assert.equal(bufferToString(tokens[5][1]), '</tr>');
      assert.equal(tokens[6][0], 'close');
      assert.equal(bufferToString(tokens[6][1]), '</table>');
    });

    test('complex table with attributes', async () => {
      const tokens = await tokenize('<table class="data"><thead><tr><th colspan="2">Header</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>');
      assert.equal(tokens.length, 19);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<table class="data">');
      assert.equal(tokens[1][0], 'open');
      assert.equal(bufferToString(tokens[1][1]), '<thead>');
      assert.equal(tokens[4][0], 'text');
      assert.equal(bufferToString(tokens[4][1]), 'Header');
      assert.equal(tokens[18][0], 'close');
      assert.equal(bufferToString(tokens[18][1]), '</table>');
    });
  });

  describe('Edge cases', () => {
    test('loose angle brackets in text', async () => {
      const tokens = await tokenize('2 < 3 and 5 > 4');
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0][0], 'text');
      assert.equal(bufferToString(tokens[0][1]), '2 < 3 and 5 > 4');
    });

    test('malformed tags', async () => {
      const tokens = await tokenize('<div class="test">content<div>');
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class="test">');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'content');
      assert.equal(tokens[2][0], 'open');
      assert.equal(bufferToString(tokens[2][1]), '<div>');
    });

    test('empty tags', async () => {
      const tokens = await tokenize('<></>');
      assert.equal(tokens.length, 2);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<>');
      assert.equal(tokens[1][0], 'close');
      assert.equal(bufferToString(tokens[1][1]), '</>');
    });

    test('whitespace handling', async () => {
      const tokens = await tokenize('  <div  class="test"  >  content  </div>  ');
      assert.equal(tokens.length, 5);
      assert.equal(tokens[0][0], 'text');
      assert.equal(bufferToString(tokens[0][1]), '  ');
      assert.equal(tokens[1][0], 'open');
      assert.equal(bufferToString(tokens[1][1]), '<div  class="test"  >');
      assert.equal(tokens[2][0], 'text');
      assert.equal(bufferToString(tokens[2][1]), '  content  ');
      assert.equal(tokens[3][0], 'close');
      assert.equal(bufferToString(tokens[3][1]), '</div>');
      assert.equal(tokens[4][0], 'text');
      assert.equal(bufferToString(tokens[4][1]), '  ');
    });

    test('mixed content with special characters', async () => {
      const tokens = await tokenize('Text & <em>emphasis</em> > more text');
      assert.equal(tokens.length, 5);
      assert.equal(tokens[0][0], 'text');
      assert.equal(bufferToString(tokens[0][1]), 'Text & ');
      assert.equal(tokens[1][0], 'open');
      assert.equal(bufferToString(tokens[1][1]), '<em>');
      assert.equal(tokens[2][0], 'text');
      assert.equal(bufferToString(tokens[2][1]), 'emphasis');
      assert.equal(tokens[3][0], 'close');
      assert.equal(bufferToString(tokens[3][1]), '</em>');
      assert.equal(tokens[4][0], 'text');
      assert.equal(bufferToString(tokens[4][1]), ' > more text');
    });
  });

  describe('Streaming scenarios', () => {
    test('tag split across chunks', async () => {
      const tokens = await tokenizeStreaming(['<di', 'v>content</div>']);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'content');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</div>');
    });

    test('attribute split across chunks', async () => {
      const tokens = await tokenizeStreaming(['<div cla', 'ss="test">content</div>']);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class="test">');
    });

    test('text split across chunks', async () => {
      const tokens = await tokenizeStreaming(['hello ', 'world']);
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0][0], 'text');
      assert.equal(bufferToString(tokens[0][1]), 'hello world');
    });

    test('comment split across chunks', async () => {
      const tokens = await tokenizeStreaming(['<!-- hel', 'lo -->']);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<!--');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), ' hello ');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '-->');
    });

    test('script content split across chunks', async () => {
      const tokens = await tokenizeStreaming(['<script>ale', 'rt("test");</script>']);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<script>');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'alert("test");');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</script>');
    });

    test('many small chunks', async () => {
      const input = '<div class="test">hello world</div>';
      const chunks = input.split('').map(char => char);
      const tokens = await tokenizeStreaming(chunks);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(bufferToString(tokens[0][1]), '<div class="test">');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'hello world');
      assert.equal(tokens[2][0], 'close');
      assert.equal(bufferToString(tokens[2][1]), '</div>');
    });
  });

  describe('Performance and large documents', () => {
    test('large text block', async () => {
      const largeText = 'a'.repeat(10000);
      const tokens = await tokenize(largeText);
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0][0], 'text');
      assert.equal(bufferToString(tokens[0][1]), largeText);
    });

    test('many nested tags', async () => {
      const nested = '<div>'.repeat(100) + 'content' + '</div>'.repeat(100);
      const tokens = await tokenize(nested);
      assert.equal(tokens.length, 201); // 100 open + 1 text + 100 close
      assert.equal(tokens[100][0], 'text');
      assert.equal(bufferToString(tokens[100][1]), 'content');
    });

    test('document with many attributes', async () => {
      const attrs = Array.from({length: 50}, (_, i) => `attr${i}="value${i}"`).join(' ');
      const html = `<div ${attrs}>content</div>`;
      const tokens = await tokenize(html);
      assert.equal(tokens.length, 3);
      assert.equal(tokens[0][0], 'open');
      assert.equal(tokens[1][0], 'text');
      assert.equal(bufferToString(tokens[1][1]), 'content');
    });
  });
});