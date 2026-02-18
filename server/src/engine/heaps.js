export class Heap {
    constructor(compareFn) {
        this.a = [];
        this.cmp = compareFn;
    }

    size() {
        return this.a.length;
    }

    peek() {
        return this.a.length > 0 ? this.a[0] : null;
    }

    push(x) {
        const a = this.a;
        a.push(x);
        this._siftUp(a.length - 1);
    }

    pop() {
        const a  = this.a;
        if (!a.length) return null;
        const top = a[0];
        const last = a.pop();
        if (a.length) {
            a[0] = last;
            this._siftDown(0);
        }
        return top;
    }

    _siftUp(i) {
        const a = this.a;
        while (i > 0) {
            const p = (i - 1) >> 1; // parent index
            if (this.cmp(a[i], a[p])) break;
            [a[p], a[i]] = [a[i], a[p]]; // swap
            i = p;
        }
    }

    _siftDown(i) {
        const a = this.a;
        const n = a.length;

        while (true) {
            const l = (i << 1) + 1; // left child index
            const r = (i << 1) + 2; // right child index
            let best = i;

            if (l < n && this.cmp(a[l], a[best])) best = l;
            if (r < n && this.cmp(a[r], a[best])) best = r;

            if (best === i) break; // heap property is satisfied
            [a[i], a[best]] = [a[best], a[i]];
            i = best;
        }
    }
}

