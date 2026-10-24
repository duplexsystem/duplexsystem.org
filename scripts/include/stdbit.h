#ifndef RUNNABLE_STDBIT_H
#define RUNNABLE_STDBIT_H

#define __STDC_VERSION_STDBIT_H__ 202311L

#define __stdbit_width(x) ((int)(sizeof(x) * 8))

#define stdc_leading_zeros(x) ((unsigned int)__builtin_clzg((x), __stdbit_width(x)))
#define stdc_leading_ones(x) ((unsigned int)__builtin_clzg((__typeof__(x))~(x), __stdbit_width(x)))
#define stdc_trailing_zeros(x) ((unsigned int)__builtin_ctzg((x), __stdbit_width(x)))
#define stdc_trailing_ones(x) ((unsigned int)__builtin_ctzg((__typeof__(x))~(x), __stdbit_width(x)))
#define stdc_count_ones(x) ((unsigned int)__builtin_popcountg(x))
#define stdc_count_zeros(x) ((unsigned int)__builtin_popcountg((__typeof__(x))~(x)))
#define stdc_bit_width(x) ((unsigned int)(__stdbit_width(x) - __builtin_clzg((x), __stdbit_width(x))))
#define stdc_has_single_bit(x) (__builtin_popcountg(x) == 1)

#define __stdbit_typed(name, suffix, type) \
    static inline unsigned int name##_##suffix(type x) { return name(x); }
#define __stdbit_all(name)                        \
    __stdbit_typed(name, uc, unsigned char)       \
    __stdbit_typed(name, us, unsigned short)      \
    __stdbit_typed(name, ui, unsigned int)        \
    __stdbit_typed(name, ul, unsigned long)       \
    __stdbit_typed(name, ull, unsigned long long)
__stdbit_all(stdc_leading_zeros)
__stdbit_all(stdc_leading_ones)
__stdbit_all(stdc_trailing_zeros)
__stdbit_all(stdc_trailing_ones)
__stdbit_all(stdc_count_ones)
__stdbit_all(stdc_count_zeros)
__stdbit_all(stdc_bit_width)

#endif
