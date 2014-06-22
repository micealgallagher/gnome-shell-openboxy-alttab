.PHONY: package schemas

SHELL = /bin/bash

package: schemas
	rm -f extension.zip
	zip dist.zip * -x Makefile

schemas:
	glib-compile-schemas schemas
