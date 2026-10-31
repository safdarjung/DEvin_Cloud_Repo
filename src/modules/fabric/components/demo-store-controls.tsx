"use client";

import { useRef, useState } from "react";
import { Download, MoreHorizontal, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dispatch, exportJson, getState, parseImport } from "@/modules/fabric/store";
import { downloadFile } from "./download";
import { useFabricSeed } from "./fabric-provider";

export function DemoStoreControls() {
  const seed = useFabricSeed();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  async function onImport(file: File | undefined) {
    if (!file) return;
    const result = parseImport(await file.text());
    if (!result.ok || !result.state) {
      setImportError(result.error ?? "Invalid state");
      return;
    }
    setImportError(null);
    dispatch({ type: "importState", state: result.state });
    setOpen(false);
    toast.success("Demo state imported");
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Demo data controls">
            <MoreHorizontal aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-1 p-2">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Demo data (this browser only)</p>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              setOpen(false);
              setConfirmReset(true);
            }}
          >
            <RotateCcw aria-hidden /> Reset demo data
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start"
            onClick={() => {
              downloadFile("fabric-demo.json", exportJson(getState()), "application/json");
              setOpen(false);
            }}
          >
            <Download aria-hidden /> Export demo state
          </Button>
          <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden /> Import demo state
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Import demo state file"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {importError && <ErrorState title="Import failed" description={importError} />}
        </PopoverContent>
      </Popover>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>
              Installs, scenarios, layouts and other demo changes in this browser return to the starting set.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                dispatch({ type: "reset", seedData: seed });
                setConfirmReset(false);
                toast.success("Demo data reset");
              }}
            >
              Reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
