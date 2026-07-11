import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CsvDropzone } from "@/components/ui/csv-dropzone";

// CsvDropzone is a controlled component — mirror how Setup actually owns
// `value`, so a successful pick is visible in the rendered preview, not just
// in the onChange spy.
function ControlledDropzone({ onChange }: { onChange: (f: File | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <CsvDropzone
      value={file}
      onChange={(f) => {
        setFile(f);
        onChange(f);
      }}
    />
  );
}

describe("CsvDropzone — Use demo dataset", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the sample CSV and drops it into the zone", async () => {
    const csv = "date,item,quantity,price\n2026-01-01,pork,3,10\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob([csv], { type: "text/csv" })),
      }),
    );
    const onChange = vi.fn();
    render(<ControlledDropzone onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /use demo dataset/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const file = onChange.mock.calls[0][0] as File;
    expect(file.name).toBe("wastewise-sample.csv");
    expect(await screen.findByText("wastewise-sample.csv")).toBeInTheDocument();
  });

  it("shows an error instead of silently doing nothing when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const onChange = vi.fn();
    render(<ControlledDropzone onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /use demo dataset/i }));

    expect(await screen.findByText(/couldn't load the demo dataset/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
