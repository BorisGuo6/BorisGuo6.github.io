#!/usr/bin/env bash
# Build both CV versions from main.tex
# main.pdf      — selected publications & top awards (\fullcvfalse, linked from website)
# main-full.pdf — all publications & awards (\fullcvtrue)
set -e
cd "$(dirname "$0")"

echo "Building selected CV (main.pdf)..."
latexmk -pdf -interaction=nonstopmode main.tex

echo "Building full CV (main-full.pdf)..."
sed 's/\\fullcvfalse/\\fullcvtrue/' main.tex > _full.tex
latexmk -pdf -jobname=main-full -interaction=nonstopmode _full.tex
rm -f _full.tex _full.aux _full.log _full.fls _full.fdb_latexmk

echo "Cleaning intermediates..."
rm -f main.aux main.log main.out main.fls main.fdb_latexmk \
       main-full.aux main-full.log main-full.out \
       main-full.fls main-full.fdb_latexmk

echo "Done: main.pdf ($(stat -f%z main.pdf) bytes), main-full.pdf ($(stat -f%z main-full.pdf) bytes)"
