# markup-tokenizer

High-performance markup tokenizer transform stream for Node.js.

## Installation

```sh
npm install markup-tokenizer
```

## Usage

```ts
import { createReadStream } from "node:fs";
import tokenizer from "markup-tokenizer";

createReadStream("./index.html").pipe(tokenizer());
```

For the following HTML:

```html
<section>
  <a href="/hello">hello</a>
</section>
```

This produces:

```
["open", "<section>"]
["text", "\n  "]
["open", '<a href="/hello">']
["text", "hello"]
["close", "</a>"]
["text", "\n"]
["close", "</section>"]
```

## Options

### `ignoreText`

You can ignore text nodes for performance when you only need the markup structure:

```ts
import tokenizer from "markup-tokenizer";

// Only emit open/close tags, skip text content
const stream = tokenizer({ ignoreText: true });
```

With `ignoreText: true`, the same HTML produces:

```
["open", "<section>"]
["open", '<a href="/hello">']
["close", "</a>"]
["close", "</section>"]
```

This option provides significant performance benefits when processing large documents where text content is not needed.
