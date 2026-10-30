#!/bin/sh
# swf-parser reads 32-bit clip event flags as a float (SWF6+), which loses every onClipEvent handler.
sed -i 's/extendedEvents ? byteStream.readFloat32LE() : byteStream.readUint16LE()/extendedEvents ? byteStream.readUint32LE() : byteStream.readUint16LE()/' "$(dirname "$0")/node_modules/swf-parser/lib/parsers/display.mjs"
# swf-parser reports a missing text record x/y offset as 0; the pen position must carry over instead.
sed -i 's/const offsetX = hasOffsetX ? byteStream.readSint16LE() : 0;/const offsetX = hasOffsetX ? byteStream.readSint16LE() : undefined;/; s/const offsetY = hasOffsetY ? byteStream.readSint16LE() : 0;/const offsetY = hasOffsetY ? byteStream.readSint16LE() : undefined;/' "$(dirname "$0")/node_modules/swf-parser/lib/parsers/text.mjs"
