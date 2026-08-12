const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const readBuffer = (relativePath) => fs.readFileSync(path.join(root, relativePath));

function parseIco(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0);
  assert.equal(buffer.readUInt16LE(2), 1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const width = buffer[entryOffset] || 256;
    const height = buffer[entryOffset + 1] || 256;
    const byteLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    return {
      bitsPerPixel: buffer.readUInt16LE(entryOffset + 6),
      data: buffer.subarray(imageOffset, imageOffset + byteLength),
      height,
      width,
    };
  });
}

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function parseRgbaPng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let header = null;
  const compressed = [];
  while (offset < buffer.length) {
    const byteLength = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + byteLength);
    if (type === "IHDR") {
      header = {
        bitDepth: data[8],
        colorType: data[9],
        height: data.readUInt32BE(4),
        interlace: data[12],
        width: data.readUInt32BE(0),
      };
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + byteLength;
  }

  assert.ok(header);
  assert.deepEqual(
    { bitDepth: header.bitDepth, colorType: header.colorType, interlace: header.interlace },
    { bitDepth: 8, colorType: 6, interlace: 0 },
  );
  const bytesPerPixel = 4;
  const rowLength = header.width * bytesPerPixel;
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(rowLength * header.height);
  let sourceOffset = 0;

  for (let y = 0; y < header.height; y += 1) {
    const filter = filtered[sourceOffset];
    sourceOffset += 1;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = filtered[sourceOffset];
      sourceOffset += 1;
      const targetOffset = y * rowLength + x;
      const left = x >= bytesPerPixel ? pixels[targetOffset - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[targetOffset - rowLength] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[targetOffset - rowLength - bytesPerPixel]
        : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paethPredictor(left, up, upperLeft)][filter];
      assert.notEqual(predictor, undefined, `Filtro PNG no soportado: ${filter}`);
      pixels[targetOffset] = (raw + predictor) & 0xff;
    }
  }

  return {
    ...header,
    pixel(x, y) {
      const pixelOffset = y * rowLength + x * bytesPerPixel;
      return [...pixels.subarray(pixelOffset, pixelOffset + bytesPerPixel)];
    },
  };
}

function composite(pixel, background) {
  const alpha = pixel[3] / 255;
  return background.map((channel, index) => Math.round(pixel[index] * alpha + channel * (1 - alpha)));
}

test("native titlebar keeps official controls and aligns Windows hover contrast with the launcher theme", () => {
  const main = read("gui/main.js");
  const css = read("gui/renderer/styles/app.css");
  const tokens = read("gui/renderer/styles/tokens.css");

  assert.match(tokens, /--native-titlebar-height: 32px/);
  assert.equal((tokens.match(/--window-titlebar-rule\s*:/g) || []).length, 1);
  assert.match(main, /const NATIVE_TITLE_BAR_OVERLAY_COLOR = "#00000000"/);
  assert.match(main, /function nativeTitleBarOverlay\(theme\)[\s\S]*color: NATIVE_TITLE_BAR_OVERLAY_COLOR[\s\S]*height: NATIVE_TITLE_BAR_HEIGHT[\s\S]*symbolColor: dark \? "#f8fafc" : "#0f172a"/);
  assert.match(main, /platform === "darwin"[\s\S]*titleBarStyle: "hiddenInset"/);
  assert.match(main, /titleBarOverlay: nativeTitleBarOverlay\(theme\)[\s\S]*titleBarStyle: "hidden"/);
  assert.match(main, /function applyNativeThemeSource\(theme\)[\s\S]*process\.platform === "win32"[\s\S]*nativeTheme\.themeSource = theme === "light" \? "light" : "dark"/);
  assert.match(main, /function applyNativeWindowTheme\(window, theme\)[\s\S]*applyNativeThemeSource\(theme\)[\s\S]*setBackgroundColor[\s\S]*setTitleBarOverlay/);
  assert.match(main, /function createMainWindow\(\)[\s\S]*applyNativeThemeSource\(theme\.effectiveTheme\)[\s\S]*new BrowserWindow/);

  const titlebar = css.slice(css.indexOf(".window-titlebar {"), css.indexOf("main,\n.launcher-header"));
  assert.match(titlebar, /height: var\(--native-titlebar-height\)/);
  assert.match(titlebar, /border-bottom: 1px solid var\(--window-titlebar-rule\)/);
  assert.match(titlebar, /env\(titlebar-area-x, 0px\)/);
  assert.match(titlebar, /env\(titlebar-area-width, 100vw\)/);
  assert.match(titlebar, /env\(titlebar-area-y, 0px\)/);
  assert.match(titlebar, /env\(titlebar-area-height, var\(--native-titlebar-height\)\)/);
  assert.doesNotMatch(titlebar, /152px/);
  assert.match(titlebar, /pointer-events: none/);
  assert.match(titlebar, /html\[data-platform="win32"\][\s\S]*33\.333333%[\s\S]*66\.666667%/);
  assert.match(titlebar, /html:not\(\[data-theme="dark"\]\) \.window-titlebar\s*\{[^}]*--window-caption-cluster-surface: transparent/);
  assert.match(titlebar, /\.window-titlebar::before\s*\{[^}]*box-shadow: inset -1px 0 0 var\(--window-titlebar-rule\)/);
  assert.match(titlebar, /\.window-titlebar::after\s*\{[^}]*box-shadow: inset 1px 0 0 var\(--window-titlebar-rule\)/);
  assert.doesNotMatch(titlebar, /inset 0 1px 0 var\(--window-titlebar-rule\)/);
  assert.doesNotMatch(titlebar, /\.window-titlebar::after\s*\{[^}]*inset -1px 0 0/);
  assert.doesNotMatch(titlebar, /html\[data-platform="linux"\][\s\S]*33\.333333%/);
  assert.match(titlebar, /html\[data-platform="darwin"\] \.window-titlebar[\s\S]*padding-inline: 78px 12px/);
  assert.doesNotMatch(titlebar, /html\[data-platform="darwin"\] \.window-titlebar::/);
});

test("drawers use the canonical close asset and remain below the native titlebar", () => {
  const app = read("gui/renderer/app.js");
  const icon = read("gui/renderer/components/icon.js");
  const css = read("gui/renderer/styles/app.css");
  const closeSvg = read("gui/renderer/assets/icons/close.svg");
  const overlay = app.slice(app.indexOf("function renderOverlay"), app.indexOf("function renderStatusFooter"));

  assert.match(css, /\.modal-layer\s*\{[^}]*inset: var\(--native-titlebar-height\) 0 0/);
  assert.match(css, /\.modal-layer\s*\{[^}]*overflow: hidden/);
  assert.match(css, /\.drawer-layer\s*\{[^}]*height: 100%[^}]*max-height: 100%/);
  assert.match(icon, /close: \{ fallback: "", file: "close\.svg" \}/);
  assert.match(overlay, /renderIcon\("close", \{ className: "button-icon drawer-close-icon", fallback: "", loading: "eager", size: "sm" \}\)/);
  assert.match(overlay, /title="Cerrar" aria-label="Cerrar"/);
  assert.doesNotMatch(overlay, />\s*[x×]\s*</i);
  assert.match(closeSvg, /<svg[\s\S]*<image/);
  assert.match(closeSvg, /data:image\/png;base64,/);
  assert.doesNotMatch(closeSvg, /<script/i);
  assert.doesNotMatch(closeSvg, /xlink:href="https?:\/\//i);
  assert.match(css, /:is\(\.theme-button--icon, \.icon-button\) > \.button-icon\.ui-icon\s*\{[^}]*width: var\(--circular-control-icon-size\)[^}]*height: var\(--circular-control-icon-size\)/);
  assert.match(css, /\.theme-button--icon\s*\{[^}]*--circular-control-icon-size: 18px/);
  assert.match(css, /\.icon-button\s*\{[^}]*--circular-control-icon-size: 18px/);
  assert.doesNotMatch(css, /\.ui-icon--close\s*\{[^}]*--icon-glyph-scale/);
});

test("header and main share non-interactive rails without changing workspace geometry", () => {
  const css = read("gui/renderer/styles/app.css");
  assert.match(css, /--launcher-content-max-width: 1760px/);
  assert.match(css, /\.app-main,\s*\n\.launcher-header\s*\{[^}]*width: min\(100%, var\(--launcher-content-max-width\)\)[^}]*max-width: var\(--launcher-content-max-width\)/);
  const rails = css.slice(css.indexOf("/* Shell rails appear"), css.indexOf(".header-actions", css.indexOf("/* Shell rails appear")));
  assert.match(rails, /@media \(min-width: 1761px\)/);
  assert.match(rails, /\.launcher-header::before,[\s\S]*\.launcher-header::after,[\s\S]*\.app-main::before,[\s\S]*\.app-main::after/);
  assert.match(rails, /background: var\(--window-titlebar-rule\)/);
  assert.match(rails, /pointer-events: none/);
  assert.doesNotMatch(rails, /grid-template|padding:|margin:|max-width:/);
});

test("native PNG and every ICO representation compose transparent corners over arbitrary backgrounds", () => {
  const nativePng = parseRgbaPng(readBuffer("gui/renderer/assets/native/app-icon.png"));
  const icoFrames = parseIco(readBuffer("gui/renderer/assets/native/app-icon.ico"));
  const expectedSizes = [256, 128, 64, 48, 32, 16];
  const backgrounds = [
    [255, 255, 255],
    [148, 163, 184],
    [0, 0, 0],
    [15, 120, 168],
  ];

  assert.deepEqual(icoFrames.map((frame) => frame.width), expectedSizes);
  assert.ok(icoFrames.every((frame) => frame.bitsPerPixel === 32));
  const images = [nativePng, ...icoFrames.map((frame) => parseRgbaPng(frame.data))];
  for (const image of images) {
    assert.equal(image.width, image.height);
    const corners = [
      image.pixel(0, 0),
      image.pixel(image.width - 1, 0),
      image.pixel(0, image.height - 1),
      image.pixel(image.width - 1, image.height - 1),
    ];
    for (const corner of corners) {
      assert.equal(corner[3], 0, `${image.width}px debe conservar alpha cero en las esquinas`);
      for (const background of backgrounds) {
        assert.deepEqual(composite(corner, background), background);
      }
    }
    assert.equal(image.pixel(Math.floor(image.width / 2), Math.floor(image.height / 2))[3], 255);
  }
});
