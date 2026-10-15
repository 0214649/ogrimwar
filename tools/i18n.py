"""Read Dofus 3 I18n/<lang>.bin: [7-bit-len str lang][int32 n][n × (int32 id, int32 offset)] then 7-bit-len UTF-8 strings."""
import struct
def _str(d, p):
    n = shift = 0
    while True:
        b = d[p]; p += 1; n |= (b & 0x7f) << shift; shift += 7
        if not b & 0x80: break
    return d[p:p + n].decode('utf-8', 'replace'), p + n
def load(path):
    d = open(path, 'rb').read()
    lang, p = _str(d, 0)
    count, = struct.unpack_from('<i', d, p); p += 4
    out = {}
    for k in range(count):
        i, off = struct.unpack_from('<ii', d, p + 8 * k)
        try: out[i] = _str(d, off)[0]
        except Exception: pass
    return out
