import type { AllPrimitiveNumberTypes_T } from "@l2js/core/buffer-value";
import { FPrimitiveArray } from "@l2js/core/unreal/un-array";

// @l2js/core currently detects misalignment by matching a Chromium error
// message. Package arrays can begin at any byte offset; WebKit uses a different
// message. Keep aligned views zero-copy and align only the requested byte range.
class AlignedPrimitiveArray<T extends AllPrimitiveNumberTypes_T> extends FPrimitiveArray<T> {
    public getTypedArray(): ReturnType<FPrimitiveArray<T>["getTypedArray"]> {
        const TypedArray = this.Constructor.dtype;
        const view = this.array;

        if (view.byteOffset % TypedArray.BYTES_PER_ELEMENT === 0)
            return new TypedArray(view.buffer, view.byteOffset, this.getElemCount()) as ReturnType<FPrimitiveArray<T>["getTypedArray"]>;

        return new TypedArray(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)) as ReturnType<FPrimitiveArray<T>["getTypedArray"]>;
    }
}

// Lazy primitive arrays inherit this method as well. Install in each JS realm
// that decodes packages, without changing the dependency in node_modules.
FPrimitiveArray.prototype.getTypedArray = AlignedPrimitiveArray.prototype.getTypedArray;
