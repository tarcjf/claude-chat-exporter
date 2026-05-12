SRC = claude-chat-exporter.js
OUT = dist-bookmarklet.js

.PHONY: all clean
all: $(OUT)

$(OUT): $(SRC)
	python3 -c 'import sys, urllib.parse; print("javascript:" + urllib.parse.quote("(function(){" + sys.stdin.read() + "})();void 0;", safe=""), end="")' < $(SRC) > $(OUT)

clean:
	rm -f $(OUT)
