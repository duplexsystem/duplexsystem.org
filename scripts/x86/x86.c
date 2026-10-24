#include <stdint.h>

#define CF 1u
#define ZF 2u
#define SF 4u
#define OF 8u

static unsigned flags;

static inline uint64_t mask(int w) { return w == 8 ? ~0ull : (1ull << (w * 8)) - 1; }
static inline uint64_t top(int w) { return 1ull << (w * 8 - 1); }
static inline int64_t sext(uint64_t v, int w)
{
    return w == 8 ? (int64_t)v : (int64_t)((v ^ top(w)) - top(w));
}
static inline unsigned zs(uint64_t r, int w) { return (r ? 0 : ZF) | (r & top(w) ? SF : 0); }

unsigned x86_flags(void) { return flags; }

static uint64_t add_carry(uint64_t a, uint64_t b, unsigned c, int w)
{
    uint64_t r = (a + b + c) & mask(w);
    flags = (c ? r <= a : r < a) | zs(r, w) | (~(a ^ b) & (a ^ r) & top(w) ? OF : 0);
    return r;
}

static uint64_t sub_borrow(uint64_t a, uint64_t b, unsigned c, int w)
{
    uint64_t r = (a - b - c) & mask(w);
    flags = (c ? a <= b : a < b) | zs(r, w) | ((a ^ b) & (a ^ r) & top(w) ? OF : 0);
    return r;
}

uint64_t x86_add(uint64_t a, uint64_t b, int w, unsigned fl) { return add_carry(a, b, 0, w); }
uint64_t x86_adc(uint64_t a, uint64_t b, int w, unsigned fl) { return add_carry(a, b, fl & CF, w); }
uint64_t x86_sub(uint64_t a, uint64_t b, int w, unsigned fl) { return sub_borrow(a, b, 0, w); }
uint64_t x86_sbb(uint64_t a, uint64_t b, int w, unsigned fl) { return sub_borrow(a, b, fl & CF, w); }

uint64_t x86_and(uint64_t a, uint64_t b, int w, unsigned fl) { return flags = zs(a & b, w), a & b; }
uint64_t x86_or(uint64_t a, uint64_t b, int w, unsigned fl) { return flags = zs(a | b, w), a | b; }
uint64_t x86_xor(uint64_t a, uint64_t b, int w, unsigned fl) { return flags = zs(a ^ b, w), a ^ b; }

__attribute__((noinline, optnone)) static uint64_t umulh(uint64_t a, uint64_t b)
{
    uint64_t al = (uint32_t)a, ah = a >> 32, bl = (uint32_t)b, bh = b >> 32;
    uint64_t mid = (al * bl >> 32) + (uint32_t)(ah * bl) + al * bh;
    return ah * bh + (ah * bl >> 32) + (mid >> 32);
}

uint64_t x86_imul(uint64_t a, uint64_t b, int w, unsigned fl)
{
    int64_t sa = sext(a, w), sb = sext(b, w);
    uint64_t r;
    int over;
    if (w < 8) {
        int64_t p = sa * sb;
        r = (uint64_t)p & mask(w);
        over = p != sext(r, w);
    } else {
        uint64_t hi = umulh(a, b) - ((sa < 0 ? b : 0) + (sb < 0 ? a : 0));
        r = a * b;
        over = hi != ((int64_t)r < 0 ? ~0ull : 0);
    }
    flags = (over ? CF | OF : 0) | zs(r, w);
    return r;
}

static inline unsigned count(uint64_t c, int w) { return c & (w == 8 ? 63 : 31); }

uint64_t x86_shl(uint64_t a, uint64_t c, int w, unsigned fl)
{
    unsigned n = count(c, w), bits = w * 8;
    if (!n) return flags = fl, a;
    uint64_t r = n >= bits ? 0 : (a << n) & mask(w);
    unsigned cf = n <= bits ? (a >> (bits - n)) & 1 : 0;
    flags = cf | zs(r, w) | (n == 1 ? ((r & top(w) ? 1 : 0) ^ cf ? OF : 0) : fl & OF);
    return r;
}

uint64_t x86_shr(uint64_t a, uint64_t c, int w, unsigned fl)
{
    unsigned n = count(c, w);
    if (!n) return flags = fl, a;
    uint64_t r = n >= 64 ? 0 : a >> n;
    flags = ((a >> (n - 1)) & 1) | zs(r, w) | (n == 1 ? (a & top(w) ? OF : 0) : fl & OF);
    return r;
}

uint64_t x86_sar(uint64_t a, uint64_t c, int w, unsigned fl)
{
    unsigned n = count(c, w);
    if (!n) return flags = fl, a;
    int64_t s = sext(a, w);
    uint64_t r = (uint64_t)(s >> (n > 63 ? 63 : n)) & mask(w);
    flags = ((s >> (n - 1)) & 1) | zs(r, w) | (n == 1 ? 0 : fl & OF);
    return r;
}

uint64_t x86_lzcnt(uint64_t a, uint64_t unused, int w, unsigned fl)
{
    uint64_t n = a ? (uint64_t)__builtin_clzll(a) - (64 - w * 8) : (uint64_t)w * 8;
    flags = (fl & (SF | OF)) | (a ? 0 : CF) | (n ? 0 : ZF);
    return n;
}

uint64_t x86_bsr(uint64_t a, uint64_t old, int w, unsigned fl)
{
    if (!a) return flags = fl | ZF, old;
    flags = fl & ~ZF;
    return 63 - (uint64_t)__builtin_clzll(a);
}
