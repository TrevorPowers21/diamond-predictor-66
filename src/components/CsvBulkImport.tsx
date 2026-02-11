import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, RefreshCw, CheckCircle, AlertCircle, FileText } from "lucide-react";

type ImportResult = {
  success: boolean;
  players_matched?: number;
  players_created?: number;
  predictions_created?: number;
  skipped?: number;
  total_rows?: number;
  errors?: string[];
  error?: string;
};

export default function CsvBulkImport() {
  const [file, setFile] = useState<File | null>(null);
  const [modelType, setModelType] = useState<"returner" | "transfer">("returner");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.endsWith(".csv")) {
        toast.error("Please upload a .csv file");
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error("File too large (max 10MB)");
        return;
      }
      setFile(f);
      setResult(null);
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Select a CSV file first");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const csvText = await file.text();

      const { data, error } = await supabase.functions.invoke("csv-bulk-import", {
        body: {
          csv_data: csvText,
          model_type: modelType,
          season: 2025,
        },
      });

      if (error) throw error;

      const res = data as ImportResult;
      setResult(res);

      if (res?.success) {
        toast.success(
          `Imported ${res.predictions_created ?? 0} predictions (${res.players_created ?? 0} new players, ${res.players_matched ?? 0} matched)`
        );
      } else {
        toast.error(res?.error ?? "Import failed");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
      setResult({ success: false, error: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            CSV Bulk Import
          </CardTitle>
          <CardDescription>
            Upload a CSV with player data and advanced metrics. Players are matched by first + last name.
            Missing class year defaults to SO → JR. You can edit class transitions on the Returning Players page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>CSV File</Label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => inputRef.current?.click()}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {file ? (
                  <div className="space-y-1">
                    <FileText className="h-8 w-8 mx-auto text-primary" />
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Click to select CSV</p>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Model Type</Label>
                <Select value={modelType} onValueChange={(v) => setModelType(v as "returner" | "transfer")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="returner">Returner</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleImport}
                disabled={!file || loading}
                className="w-full gap-2"
              >
                {loading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {loading ? "Importing…" : "Import CSV"}
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p><strong>Supported columns:</strong> playerFirstName, player (last name), playerFullName, pos, newestTeamName, batsHand, BA, OBP, SLG, ExitVel, Barrel%, Miss%/Whiff%, Chase%, class_year</p>
            <p>Players are matched by name. New players are created automatically. Multiple CSVs can be uploaded to merge data.</p>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className={result.success ? "border-primary/30" : "border-destructive/30"}>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-primary mt-0.5" />
              ) : (
                <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
              )}
              <div className="space-y-1 text-sm">
                <p className="font-medium">{result.success ? "Import Complete" : "Import Failed"}</p>
                {result.error && <p className="text-destructive">{result.error}</p>}
                {result.total_rows !== undefined && <p>Total rows: {result.total_rows}</p>}
                {result.players_matched !== undefined && <p>Players matched: {result.players_matched}</p>}
                {result.players_created !== undefined && <p>Players created: {result.players_created}</p>}
                {result.predictions_created !== undefined && <p>Predictions created: {result.predictions_created}</p>}
                {result.skipped !== undefined && result.skipped > 0 && (
                  <p className="text-muted-foreground">Skipped: {result.skipped}</p>
                )}
                {result.errors && result.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="font-medium text-destructive">Errors ({result.errors.length}):</p>
                    <ul className="list-disc list-inside text-xs text-destructive/80 mt-1">
                      {result.errors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
