// Renders the Halation logo (Java, 2026-10-22) from its hand-drawn vector source, docs/media/brand/source/halation-mark.svg:
// one continuous white stroke with round caps, turned -18 degrees, in a square viewBox.
//
// Writes:
// - assets/halation-mark.png (512 px): the transparent mark.
// - assets/halation-app-icon.png (256 px): the window and taskbar icon, the mark at 62% on a flat #111111 rounded
//   square (the interface's surface grey) with an 8% white hairline.
// - assets/halation-app-icon.ico: the same icon at 16, 24, 32, 48 and 256 px, embedded in the Windows executable
//   (crates/halation-app/build.rs) and used for the window and taskbar.
// - docs/media/brand/: halation-mark.svg (the source), halation-app-icon.svg, halation-mark-source.png (the mark PNG).
//
// Usage: node tools/render-brand.js   (CHROME and NODE_PATH as needed for Playwright)
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const MARK_PNG = 512;
const ICON_PNG = 256;
const ICO_SIZES = [16, 24, 32, 48, 256];
// Share of the square the mark spans
const SPAN = 0.62;

const root = path.join(__dirname, "..");
const brand = path.join(root, "docs", "media", "brand");
const markSvg = fs.readFileSync(path.join(brand, "source", "halation-mark.svg"), "utf8").trim() + "\n";

function iconSvg() {
    const [vx, vy, vw, vh] = markSvg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
    if (vw !== vh) throw new Error("The mark's viewBox must be square");
    const art = markSvg.trim().replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const scale = +((1024 * SPAN) / vw).toFixed(4);
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`,
        `<rect width="1024" height="1024" rx="228" fill="#111111"/>`,
        `<rect x="4" y="4" width="1016" height="1016" rx="224" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="8"/>`,
        `<g transform="translate(512 512) scale(${scale}) translate(${-(vx + vw / 2)} ${-(vy + vh / 2)})">${art}</g>`,
        `</svg>`,
        "",
    ].join("\n");
}

async function rasterize(page, svg, size) {
    const { png, rgba } = await page.evaluate(
        async ({ svg, size }) => {
            const image = new Image();
            image.src = "data:image/svg+xml;base64," + btoa(svg);
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const context = canvas.getContext("2d");
            context.imageSmoothingQuality = "high";
            context.drawImage(image, 0, 0, size, size);
            return {
                png: canvas.toDataURL("image/png").split(",")[1],
                rgba: Array.from(context.getImageData(0, 0, size, size).data),
            };
        },
        { svg, size },
    );
    return { png: Buffer.from(png, "base64"), rgba: Buffer.from(rgba) };
}

// One 32-bit bottom-up DIB, the icon format Windows reads without a PNG decoder. The height in the header is twice the
// icon's because the AND mask that follows counts too; the mask is fully transparent (the alpha channel already says
// which pixels show).
function bmpEntry(size, rgba) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(size * size * 4, 20);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const source = (y * size + x) * 4;
            const target = ((size - 1 - y) * size + x) * 4;
            pixels[target] = rgba[source + 2];
            pixels[target + 1] = rgba[source + 1];
            pixels[target + 2] = rgba[source];
            pixels[target + 3] = rgba[source + 3];
        }
    }
    const maskStride = ((size + 31) >> 5) * 4;
    return Buffer.concat([header, pixels, Buffer.alloc(maskStride * size)]);
}

// A Windows .ico: a directory of images at the sizes Explorer, the taskbar and Alt+Tab ask for. PNG compresses the
// 256 px entry (Vista and later read it); the smaller ones stay plain DIBs, the format every Windows version reads.
function ico(entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    const directory = Buffer.alloc(16 * entries.length);
    let offset = header.length + directory.length;
    entries.forEach(({ size, data }, index) => {
        const entry = index * 16;
        directory.writeUInt8(size === 256 ? 0 : size, entry);
        directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(data.length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        offset += data.length;
    });
    return Buffer.concat([header, directory, ...entries.map(({ data }) => data)]);
}

async function main() {
    const icon = iconSvg();
    const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    try {
        const page = await browser.newPage();
        const mark = await rasterize(page, markSvg, MARK_PNG);
        fs.writeFileSync(path.join(root, "assets", "halation-mark.png"), mark.png);
        fs.writeFileSync(path.join(root, "assets", "halation-app-icon.png"), (await rasterize(page, icon, ICON_PNG)).png);
        const entries = [];
        for (const size of ICO_SIZES) {
            const image = await rasterize(page, icon, size);
            entries.push({ size, data: size === 256 ? image.png : bmpEntry(size, image.rgba) });
        }
        fs.writeFileSync(path.join(root, "assets", "halation-app-icon.ico"), ico(entries));
        fs.writeFileSync(path.join(brand, "halation-mark-source.png"), mark.png);
        fs.writeFileSync(path.join(brand, "halation-mark.svg"), markSvg);
        fs.writeFileSync(path.join(brand, "halation-app-icon.svg"), icon);
    } finally {
        await browser.close();
    }
    console.log("wrote assets/halation-mark.png, assets/halation-app-icon.png, assets/halation-app-icon.ico and docs/media/brand/");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
