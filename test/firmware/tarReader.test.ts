import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readTar, TarError, type TarEntry } from "../../src/firmware/tarReader";
import { buildTar } from "./tarHelper";

/** Deliver the archive in tiny chunks to exercise block reassembly. */
function chunked(buf: Buffer, size = 100): Readable {
	const parts: Buffer[] = [];
	for (let i = 0; i < buf.length; i += size) parts.push(buf.subarray(i, i + size));
	return Readable.from(parts);
}

type Seen = { e: Pick<TarEntry, "name" | "size" | "typeflag" | "mode">; body?: string };

async function collect(buf: Buffer, readBodies = true): Promise<Seen[]> {
	const out: Seen[] = [];
	await readTar(chunked(buf), async (entry) => {
		const body = readBodies ? (await entry.read(1024)).toString() : undefined;
		out.push({ e: { name: entry.name, size: entry.size, typeflag: entry.typeflag, mode: entry.mode }, body });
	});
	return out;
}

describe("tarReader", () => {
	it("reads a ustar entry (name, size, typeflag, mode, body)", async () => {
		const r = await collect(buildTar([{ name: "./a.txt", body: "hello", mode: 0o750 }]));
		expect(r).toEqual([{ e: { name: "./a.txt", size: 5, typeflag: "0", mode: 0o750 }, body: "hello" }]);
	});

	it("joins the ustar prefix and name", async () => {
		const r = await collect(buildTar([{ prefix: "some/dir", name: "f.png", body: "x" }]));
		expect(r[0].e.name).toBe("some/dir/f.png");
	});

	it("pax path overrides the header name", async () => {
		const r = await collect(buildTar([{ name: "short", body: "x", pax: { path: "./very/long/pax/path.png", mtime: "1.5" } }]));
		expect(r.map((x) => x.e.name)).toEqual(["./very/long/pax/path.png"]);
	});

	it("pax size overrides the header size", async () => {
		const r = await collect(buildTar([{ name: "a", body: "abcdef", rawSize: "00000000000", pax: { size: "6" } }, { name: "b", body: "z" }]));
		expect(r.map((x) => [x.e.name, x.e.size, x.body])).toEqual([["a", 6, "abcdef"], ["b", 1, "z"]]);
	});

	it("ignores pax global headers (g)", async () => {
		const r = await collect(buildTar([{ name: "ignored", typeflag: "g", body: "20 comment=hello\n" }, { name: "real", body: "1" }]));
		expect(r.map((x) => x.e.name)).toEqual(["real"]);
	});

	it("uses the GNU long name (L)", async () => {
		const long = "./" + "d/".repeat(80) + "x.png";
		const r = await collect(buildTar([{ name: "truncated", body: "x", gnuLongName: long }]));
		expect(r[0].e.name).toBe(long);
	});

	it("skips unread bodies (incl. padding) and keeps later entries aligned", async () => {
		const big = "q".repeat(1300);
		const r = await collect(buildTar([{ name: "one", body: big }, { name: "two", body: "" }, { name: "three", body: "3" }]), false);
		expect(r.map((x) => [x.e.name, x.e.size])).toEqual([["one", 1300], ["two", 0], ["three", 1]]);
	});

	it("rejects an archive that ends at EOF between entries (no end-of-archive marker)", async () => {
		const cut = buildTar([{ name: "a", body: "1" }, { name: "b", body: "2" }], { terminator: false });
		await expect(collect(cut)).rejects.toThrow(TarError);
		await expect(collect(cut)).rejects.toThrow(/end-of-archive/i);
		await expect(collect(Buffer.alloc(0))).rejects.toThrow(/end-of-archive/i);
	});

	it("accepts one zero block as the end marker (GNU tar tolerates it) and the standard two", async () => {
		const one = Buffer.concat([buildTar([{ name: "a", body: "1" }], { terminator: false }), Buffer.alloc(512)]);
		expect(await collect(one)).toHaveLength(1);
		expect(await collect(buildTar([{ name: "a", body: "1" }]))).toHaveLength(1);
	});

	it("stops at the end-of-archive blocks, ignoring what follows", async () => {
		const withTrailer = Buffer.concat([buildTar([{ name: "a", body: "1" }]), Buffer.alloc(512, 1)]);
		expect(await collect(withTrailer)).toHaveLength(1);
	});

	it("reads from a file path", async () => {
		const dir = mkdtempSync(join(tmpdir(), "irite-tar-"));
		try {
			const p = join(dir, "t.tar");
			writeFileSync(p, buildTar([{ name: "f", body: "disk" }]));
			const names: string[] = [];
			await readTar(p, (e) => {
				names.push(e.name);
			});
			expect(names).toEqual(["f"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects a bad header checksum with TarError", async () => {
		const bad = buildTar([{ name: "a", body: "1", badChecksum: true }]);
		await expect(readTar(chunked(bad), () => {})).rejects.toBeInstanceOf(TarError);
		await expect(readTar(chunked(bad), () => {})).rejects.toThrow(/checksum/i);
	});

	it("rejects a truncated body with TarError", async () => {
		const full = buildTar([{ name: "a", body: "x".repeat(2000) }]);
		const cut = full.subarray(0, 512 + 700);
		await expect(readTar(chunked(cut), (e) => e.skip())).rejects.toThrow(/truncated/i);
		await expect(
			readTar(chunked(cut), async (e) => {
				await e.read(4096);
			}),
		).rejects.toBeInstanceOf(TarError);
	});

	it("rejects a truncated header with TarError", async () => {
		const full = buildTar([{ name: "a", body: "x" }]);
		await expect(readTar(chunked(full.subarray(0, 300)), () => {})).rejects.toThrow(/truncated/i);
	});

	it("rejects a non-octal size with TarError", async () => {
		await expect(readTar(chunked(buildTar([{ name: "a", body: "1", rawSize: "12abc" }])), () => {})).rejects.toThrow(/size/i);
	});

	it("rejects reading a body larger than the bound", async () => {
		await expect(
			readTar(chunked(buildTar([{ name: "a", body: "x".repeat(600) }])), async (e) => {
				await e.read(100);
			}),
		).rejects.toThrow(/exceeds/i);
	});
});
