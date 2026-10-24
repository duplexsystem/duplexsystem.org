#include <stdint.h>

#define N 8u
#define Z 4u
#define C 2u
#define V 1u

static unsigned flags;

static inline uint64_t mask(int w) { return w == 8 ? ~0ull : 0xffffffffull; }
static inline unsigned nz(uint64_t r, int w)
{
    r &= mask(w);
    return (r >> (w * 8 - 1) & 1 ? N : 0) | (r ? 0 : Z);
}

unsigned arm64_flags(void) { return flags; }

static uint64_t add_carry(uint64_t a, uint64_t b, unsigned c, int w)
{
    uint64_t m = mask(w), top = 1ull << (w * 8 - 1);
    a &= m;
    b &= m;
    uint64_t r = (a + b + c) & m;
    unsigned carry = w == 8 ? (c ? r <= a : r < a) : ((a + b + c) >> 32) & 1;
    flags = nz(r, w) | (carry ? C : 0) | ((~(a ^ b) & (a ^ r) & top) ? V : 0);
    return r;
}

uint64_t arm64_add(uint64_t a, uint64_t b, int w, unsigned fl) { return add_carry(a, b, 0, w); }
uint64_t arm64_sub(uint64_t a, uint64_t b, int w, unsigned fl)
{
    return add_carry(a, ~b & mask(w), 1, w);
}
uint64_t arm64_adc(uint64_t a, uint64_t b, int w, unsigned fl)
{
    return add_carry(a, b, (fl & C) != 0, w);
}
uint64_t arm64_sbc(uint64_t a, uint64_t b, int w, unsigned fl)
{
    return add_carry(a, ~b & mask(w), (fl & C) != 0, w);
}

uint64_t arm64_and(uint64_t a, uint64_t b, int w, unsigned fl)
{
    uint64_t r = a & b & mask(w);
    flags = nz(r, w);
    return r;
}

uint64_t arm64_ror(uint64_t a, uint64_t n, int w, unsigned fl)
{
    unsigned bits = w * 8;
    n %= bits;
    a &= mask(w);
    return n ? ((a >> n) | (a << (bits - n))) & mask(w) : a;
}

uint64_t arm64_clz(uint64_t a, uint64_t b, int w, unsigned fl)
{
    unsigned bits = w * 8;
    a &= mask(w);
    uint64_t n = 0;
    for (uint64_t bit = 1ull << (bits - 1); bit && !(a & bit); bit >>= 1) n++;
    return n;
}

__attribute__((noinline, optnone)) static uint64_t mul_high(uint64_t a, uint64_t b)
{
    uint64_t al = a & 0xffffffffull, ah = a >> 32, bl = b & 0xffffffffull, bh = b >> 32;
    uint64_t ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
    uint64_t mid = (ll >> 32) + (lh & 0xffffffffull) + (hl & 0xffffffffull);
    return hh + (lh >> 32) + (hl >> 32) + (mid >> 32);
}

uint64_t arm64_umulh(uint64_t a, uint64_t b, int w, unsigned fl) { return mul_high(a, b); }
uint64_t arm64_smulh(uint64_t a, uint64_t b, int w, unsigned fl)
{
    uint64_t h = mul_high(a, b);
    if ((int64_t)a < 0) h -= b;
    if ((int64_t)b < 0) h -= a;
    return h;
}
