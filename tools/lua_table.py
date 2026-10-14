"""Minimal parser for the DofusWiki Module:Datatable Lua files (tables, strings, numbers, booleans)."""
import re

TOKEN = re.compile(r'''\s*(?:--\[\[.*?\]\]|--[^\n]*|(?P<s>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(?P<n>-?\d+(?:\.\d+)?)|(?P<w>[A-Za-z_][A-Za-z0-9_.]*)|(?P<p>[{}\[\]=,;()]))''', re.S)


def tokens(src):
    pos = 0
    while pos < len(src):
        m = TOKEN.match(src, pos)
        if not m:
            if src[pos:].strip() == '':
                return
            raise SyntaxError(f'bad token at {pos}: {src[pos:pos+40]!r}')
        pos = m.end()
        if m.group('s') is not None:
            s = m.group('s')[1:-1]
            yield ('s', re.sub(r'\\(.)', lambda x: {'n': '\n', 't': '\t'}.get(x.group(1), x.group(1)), s))
        elif m.group('n') is not None:
            n = m.group('n'); yield ('v', float(n) if '.' in n else int(n))
        elif m.group('w') is not None:
            w = m.group('w'); yield ('v', {'true': True, 'false': False, 'nil': None}[w]) if w in ('true', 'false', 'nil') else ('w', w)
        elif m.group('p') is not None:
            yield ('p', m.group('p'))


class Parser:
    def __init__(self, src):
        self.t = list(tokens(src)); self.i = 0

    def peek(self, k=0):
        return self.t[self.i + k] if self.i + k < len(self.t) else (None, None)

    def take(self):
        tok = self.t[self.i]; self.i += 1; return tok

    def value(self):
        kind, v = self.take()
        if kind in ('s', 'v'):
            return v
        if (kind, v) == ('p', '{'):
            return self.table()
        if kind == 'w':                      # function call like Strings.x("...") -> keep the argument
            if self.peek() == ('p', '('):
                self.take(); arg = self.value() if self.peek() != ('p', ')') else None; self.take(); return arg
            return v
        raise SyntaxError(f'unexpected {kind} {v!r}')

    def table(self):
        d, arr = {}, []
        while self.peek() != ('p', '}'):
            if self.peek() == ('p', '['):
                self.take(); k = self.value(); self.take(); self.take()  # ] =
                d[k] = self.value()
            elif self.peek()[0] == 'w' and self.peek(1) == ('p', '='):
                k = self.take()[1]; self.take(); d[k] = self.value()
            else:
                arr.append(self.value())
            if self.peek() in (('p', ','), ('p', ';')):
                self.take()
        self.take()
        if arr and not d:
            return arr
        if arr:
            d['_list'] = arr
        return d


def load(path):
    """Return {name: table} for every top-level `p.name = {...}` assignment."""
    src = open(path, encoding='utf-8').read()
    out = {}
    for m in re.finditer(r'^p\.(\w+)\s*=\s*\{', src, re.M):
        p = Parser(src[m.end() - 1:])
        p.take()
        out[m.group(1)] = p.table()
    return out
