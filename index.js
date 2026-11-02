/**
 * Host half of the Mermaid diagram bundle.
 *
 * This plugin renders entirely in the browser (the Client module owns the
 * behaviour). The Host row exists only so the module system scans and serves
 * the `dsh.client` bundle; there is nothing to do on the Host side.
 */
export function apply() {}
