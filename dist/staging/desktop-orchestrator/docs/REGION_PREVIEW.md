# Region Preview

`region-preview` captures a PNG crop for a lease-bound UIA element.

It only observes the screen. It does not click, type, move the mouse, or change desktop state.

## Flow

1. Call `ui-tree` to create a lease snapshot.
2. Choose an element with bounds.
3. Call `region-preview` with `leaseId + snapshotId + elementId`.
4. The tool captures the element region into a temporary PNG.
5. When Hana staging is available, the PNG is returned as media.

## Output

The result includes:

- `filePath`
- captured `region`
- staged media details when supported

## Safety

This tool is read-only except for writing a temporary PNG file under the system temp directory.
