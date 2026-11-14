import BufferValue from '@l2js/core/buffer-value';
import { FPrimitiveArray, FPrimitiveArrayLazy } from '@l2js/core/unreal/un-array';
import { FPrimitiveArray as PublicPrimitiveArray } from '@l2js/core';

declare const APPLY_ARRAY_COMPAT: boolean;
if (APPLY_ARRAY_COMPAT) require('../src/assets/core-array-compat');
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function load(type: any, view: DataView, lazy = false) {
    let cursor = view.byteOffset;
    const array = lazy ? new FPrimitiveArrayLazy(type) : new FPrimitiveArray(type);
    array.load({
        read: (kind: string) => kind === 'int32' ? view.byteOffset + view.byteLength : view.byteLength / type.bytes,
        tell: () => cursor,
        readPrimitive: (offset: number, length: number) => { assert(offset === view.byteOffset && length === view.byteLength, 'Package view must preserve its exact range'); return view; },
        seek: (length: number) => { cursor += length; }
    } as any);
    return array;
}
export function runPrimitiveArrayChecks() {
    assert(PublicPrimitiveArray === FPrimitiveArray, 'Public and direct core imports must share the patched class');
    for (const type of [BufferValue.uint8, BufferValue.int8, BufferValue.uint16, BufferValue.int16, BufferValue.uint32, BufferValue.int32, BufferValue.float, BufferValue.uint64, BufferValue.int64]) {
        const TypedArray = type.dtype;
        const values: any[] = type.name.includes('64') ? [1n, 7n] : type.name === 'float' ? [1.25, 2.5] : [1, 7];
        for (const offset of [TypedArray.BYTES_PER_ELEMENT, 1]) for (const lazy of [false, true]) {
            const source = new ArrayBuffer(offset + 2 * type.bytes + 5);
            new Uint8Array(source).fill(0xcc);
            new Uint8Array(source, offset, 2 * type.bytes).set(new Uint8Array(new TypedArray(values as any).buffer));
            const array = load(type, new DataView(source, offset, 2 * type.bytes), lazy);
            const result = array.getTypedArray() as any;
            assert(result.length === 2 && result[0] === values[0] && result[1] === values[1], `${type.name}: values/range must survive decoding`);
            const aligned = offset % TypedArray.BYTES_PER_ELEMENT === 0;
            assert((result.buffer === source) === aligned, `${type.name}: only aligned arrays may share storage`);
            assert(result.byteOffset === (aligned ? offset : 0), `${type.name}: wrong typed-array offset`);
            assert(result.byteLength === 2 * type.bytes, `${type.name}: copied bytes outside package view`);
            const original = result[0];
            new Uint8Array(source)[offset] ^= 1;
            assert(aligned ? result[0] !== original : result[0] === original, `${type.name}: wrong copy/share behavior`);
        }
        const empty = load(type, new DataView(new ArrayBuffer(5), 1, 0)).getTypedArray();
        assert(empty.length === 0, `${type.name}: empty unaligned array must remain empty`);
    }
    const failure = new Error('Unrelated constructor failure');
    class BrokenArray extends Uint16Array { constructor(...args: any[]) { super(...args as [any]); throw failure; } }
    for (const offset of [0, 1]) {
        let caught: unknown;
        try { load({ ...BufferValue.uint16, dtype: BrokenArray }, new DataView(new ArrayBuffer(5), offset, 2)).getTypedArray(); }
        catch (error) { caught = error; }
        assert(caught === failure, 'Unrelated constructor failures must propagate unchanged');
    }
    return 'Primitive array alignment checks passed';
}
try { (globalThis as any).primitiveArrayResult = { passed: true, message: runPrimitiveArrayChecks() }; }
catch (error) { (globalThis as any).primitiveArrayResult = { passed: false, error: `${(error as Error).name}: ${(error as Error).message}\n${(error as Error).stack || ''}` }; }
