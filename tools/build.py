#!/usr/bin/env python3
"""Yıldırım Gözlemevi derleme betiği.

index.html'in bağladığı css/ ve js/ dosyalarını tek HTML'e gömer. Çıktılar:
  dist/yildirim-gozlemevi.html  Tek dosya, tam belge; çift tıklamayla açılır, paylaşılabilir.
  dist/artifact.html            Artifact sürümü: <!doctype>, <html>, <head>, <body> sarmalayıcıları olmadan.
  dist/artifact-onizleme.html   Artifact sürümünü yayın iskeletine benzer bir sayfada sarar (yerel test için).

Kullanım: python3 tools/build.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'


def read(rel):
    path = ROOT / rel
    if not path.is_file():
        sys.exit(f'Dosya bulunamadı: {rel}')
    return path.read_text(encoding='utf-8')


def inline(html):
    def css(m):
        return '<style>\n' + read(m.group(1)) + '\n</style>'

    def js(m):
        src = m.group(1)
        code = read(src).replace('</script', '<\\/script')
        return f'<script>\n/* {src} */\n{code}\n</script>'

    html, n_css = re.subn(r'<link rel="stylesheet" href="(css/[^"]+)">', css, html)
    html, n_js = re.subn(r'<script src="(js/[^"]+)"></script>', js, html)
    return html, n_css, n_js


def artifact(full):
    head = re.search(r'<head>(.*?)</head>', full, re.S).group(1)
    body = re.search(r'<body>(.*)</body>', full, re.S).group(1)
    head = re.sub(r'<meta charset="utf-8">\s*', '', head)
    head = re.sub(r'<meta name="viewport"[^>]*>\s*', '', head)
    out = head.strip() + '\n' + body.strip() + '\n'
    if out.find('<title>') > 8000:
        sys.exit('<title> ilk 8 KB içinde değil')
    return out


PREVIEW = """<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0;font:14px system-ui;background:#f7f6f3}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>
{{ICERIK}}
</body></html>
"""


def main():
    full, n_css, n_js = inline(read('index.html'))
    DIST.mkdir(exist_ok=True)
    (DIST / 'yildirim-gozlemevi.html').write_text(full, encoding='utf-8')
    art = artifact(full)
    (DIST / 'artifact.html').write_text(art, encoding='utf-8')
    (DIST / 'artifact-onizleme.html').write_text(PREVIEW.replace('{{ICERIK}}', art), encoding='utf-8')
    kb = lambda s: len(s.encode('utf-8')) / 1024
    print(f'{n_css} stil, {n_js} betik gömüldü')
    print(f'dist/yildirim-gozlemevi.html  {kb(full):.0f} KB')
    print(f'dist/artifact.html            {kb(art):.0f} KB')


if __name__ == '__main__':
    main()
