import { ChangeEvent, ReactNode, useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type TimeOfDay = {
  kind: "time";
  minutes: number;
};

type ScalarCell = string | number | Date | TimeOfDay | null;
type GroupedEntry = {
  kommt: ScalarCell;
  geht: ScalarCell;
  abw: ScalarCell;
  pauseBez: ScalarCell;
  pauseNichtBez: ScalarCell;
};

type ParsedCell = ScalarCell | ScalarCell[] | GroupedEntry[];

type ParsedData = {
  headers: string[];
  rows: ParsedCell[][];
};

type ConstantColumn = {
  header: string;
  value: string;
};

type AbwSummaryRow = {
  label: "empty" | "KB" | "p" | "home_hrs";
  minutes: number;
  proportion: number;
};
type TableMode = "full" | "monthly";

type TimelineSegment = {
  start: number;
  end: number;
  abwCode: string;
  colorClass: string;
};

const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 18 * 60;
const DAY_DURATION_MINUTES = DAY_END_MINUTES - DAY_START_MINUTES;

const parseCsv = (text: string): string[][] => {
  const result = Papa.parse<string[]>(text, {
    delimiter: "",
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });

  const parseErrors = result.errors.filter(
    (error) => error.code !== "UndetectableDelimiter",
  );
  if (parseErrors.length > 0) {
    throw new Error(parseErrors[0].message);
  }

  return result.data.map((row) => row.map((cell) => `${cell ?? ""}`));
};

const parseDateCell = (value: string): Date | null => {
  const match = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) {
    return null;
  }

  const [, dd, mm, yyyy] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(yyyy) ||
    date.getMonth() !== Number(mm) - 1 ||
    date.getDate() !== Number(dd)
  ) {
    return null;
  }

  return date;
};

const parseIsoDateCell = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yyyy, mm, dd] = match;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(yyyy) ||
    date.getMonth() !== Number(mm) - 1 ||
    date.getDate() !== Number(dd)
  ) {
    return null;
  }

  return date;
};

const parseTimeCell = (value: string): TimeOfDay | null => {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, hh, mm] = match;
  const hours = Number(hh);
  const minutes = Number(mm);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { kind: "time", minutes: hours * 60 + minutes };
};

const parseNumberCell = (value: string): number | null => {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTypedCell = (header: string, rawValue: string): ParsedCell => {
  const value = rawValue.trim();
  if (value.length === 0) {
    return null;
  }

  const normalizedHeader = header.trim().toLowerCase();
  if (normalizedHeader === "datum") {
    return parseDateCell(value) ?? value;
  }

  if (normalizedHeader === "kommt" || normalizedHeader === "geht") {
    return parseTimeCell(value) ?? value;
  }

  if (
    normalizedHeader === "soll" ||
    normalizedHeader === "ist" ||
    normalizedHeader === "pause bez." ||
    normalizedHeader === "pause nicht bez." ||
    normalizedHeader.startsWith("gesamt")
  ) {
    return parseNumberCell(value) ?? value;
  }

  return value;
};

const cellToString = (cell: ParsedCell): string => {
  if (Array.isArray(cell)) {
    if (
      cell.length > 0 &&
      typeof cell[0] === "object" &&
      cell[0] !== null &&
      "kommt" in cell[0] &&
      "geht" in cell[0] &&
      "abw" in cell[0]
    ) {
      return "";
    }
    return cell
      .map((item) => cellToString(item))
      .filter((item) => item.trim().length > 0)
      .join(" | ");
  }
  if (cell === null) {
    return "";
  }
  if (typeof cell === "number") {
    return `${cell}`;
  }
  if (cell instanceof Date) {
    const year = cell.getFullYear();
    const month = String(cell.getMonth() + 1).padStart(2, "0");
    const day = String(cell.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof cell === "object" && cell.kind === "time") {
    const hours = String(Math.floor(cell.minutes / 60)).padStart(2, "0");
    const minutes = String(cell.minutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  return cell;
};

const isTimeOfDayCell = (value: ScalarCell): value is TimeOfDay =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "time";

const isGroupedEntryArray = (cell: ParsedCell): cell is GroupedEntry[] =>
  Array.isArray(cell) &&
  cell.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "kommt" in item &&
      "geht" in item &&
      "abw" in item,
  );

const classifyAbw = (abwCode: string): string => {
  if (abwCode.length === 0) {
    return "bg-green-600";
  }
  if (abwCode === "home_hrs") {
    return "bg-blue-600";
  }
  if (abwCode === "p") {
    return "bg-pink-500";
  }
  if (abwCode === "KB") {
    return "bg-red-950";
  }
  return "bg-slate-500";
};

const formatMinutesToTime = (minutes: number): string => {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
};

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = String(minutes % 60).padStart(2, "0");
  return `${hours}:${mins}`;
};

const formatHoursDecimal = (minutes: number): string =>
  (minutes / 60).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const dateToKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const dateToMonthKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const monthKeyToLabel = (monthKey: string): string => {
  const [yearString, monthString] = monthKey.split("-");
  const year = Number(yearString);
  const month = Number(monthString);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return monthKey;
  }
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const extractDateFromCell = (cell: ParsedCell): Date | null => {
  if (cell instanceof Date) {
    return new Date(cell.getFullYear(), cell.getMonth(), cell.getDate());
  }

  if (typeof cell === "string") {
    return parseDateCell(cell) ?? parseIsoDateCell(cell);
  }

  return null;
};

const getTimelineSegments = (entries: GroupedEntry[]): TimelineSegment[] =>
  entries
    .map((entry) => {
      if (!isTimeOfDayCell(entry.kommt) || !isTimeOfDayCell(entry.geht)) {
        return null;
      }

      const start = Math.max(DAY_START_MINUTES, entry.kommt.minutes);
      const end = Math.min(DAY_END_MINUTES, entry.geht.minutes);
      if (end <= start) {
        return null;
      }

      const abwCode = cellToString(entry.abw).trim();
      return {
        start,
        end,
        abwCode,
        colorClass: classifyAbw(abwCode),
      };
    })
    .filter((segment): segment is TimelineSegment => segment !== null);

const timelineToText = (entries: GroupedEntry[]): string => {
  const segments = getTimelineSegments(entries);
  return segments
    .map((segment) => {
      const codeSuffix =
        segment.abwCode.length > 0 ? ` (${segment.abwCode})` : "";
      return `${formatMinutesToTime(segment.start)}-${formatMinutesToTime(segment.end)}${codeSuffix}`;
    })
    .join(" | ");
};

const shouldOmitTimeline = (
  hasSoll: boolean,
  segments: TimelineSegment[],
): boolean => {
  const allSegmentsAreKb =
    segments.length > 0 &&
    segments.every((segment) => segment.abwCode === "KB");
  return !hasSoll && (segments.length === 0 || allSegmentsAreKb);
};

const headerToEntryField = (header: string): keyof GroupedEntry | null => {
  const normalized = header.trim().toLowerCase();
  if (normalized === "kommt") {
    return "kommt";
  }
  if (normalized === "geht") {
    return "geht";
  }
  if (normalized === "abw") {
    return "abw";
  }
  if (normalized === "pause bez.") {
    return "pauseBez";
  }
  if (normalized === "pause nicht bez.") {
    return "pauseNichtBez";
  }
  return null;
};

const cellToDisplayString = (header: string, cell: ParsedCell): string => {
  const normalizedHeader = header.trim().toLowerCase();

  if (normalizedHeader.startsWith("gesamt") && typeof cell === "number") {
    const absolute = Math.abs(cell).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
    const sign = cell < 0 ? "-" : "+";
    return `${sign}${absolute}`;
  }

  if (normalizedHeader === "timeline" && isGroupedEntryArray(cell)) {
    return timelineToText(cell);
  }

  const groupedField = headerToEntryField(header);
  if (groupedField && isGroupedEntryArray(cell)) {
    const entries = cell;
    return entries
      .map((entry) => cellToString(entry[groupedField]))
      .filter((value) => value.trim().length > 0)
      .join(" | ");
  }

  return cellToString(cell);
};

const isCellEmpty = (cell: ScalarCell): boolean => {
  if (cell === null) {
    return true;
  }
  return cellToString(cell).trim().length === 0;
};

const normalizeParsedRows = (rawRows: string[][]): ParsedData | null => {
  if (rawRows.length === 0) {
    return null;
  }

  const columnCount = Math.max(...rawRows.map((r) => r.length));
  const padded = rawRows.map((r) => [
    ...r,
    ...Array(Math.max(columnCount - r.length, 0)).fill(""),
  ]);

  const headers = padded[0].map((header, idx) => {
    const trimmed = header.trim();
    return trimmed.length > 0 ? trimmed : `Column ${idx + 1}`;
  });

  return {
    headers,
    rows: padded
      .slice(1)
      .map((row) => row.map((cell, idx) => parseTypedCell(headers[idx], cell))),
  };
};

const filterZeileTagRows = (parsed: ParsedData): ParsedData => {
  const zeileIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "zeile",
  );
  if (zeileIndex === -1) {
    return { headers: parsed.headers, rows: [] };
  }

  return {
    headers: parsed.headers,
    rows: parsed.rows.filter(
      (row) => cellToString(row[zeileIndex]).trim() === "Tag",
    ),
  };
};

const groupByDatum = (parsed: ParsedData): ParsedData => {
  const datumIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "datum",
  );
  if (datumIndex === -1) {
    return parsed;
  }

  const kommtIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "kommt",
  );
  const gehtIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "geht",
  );
  const abwIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "abw",
  );
  const pauseBezIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "pause bez.",
  );
  const pauseNichtBezIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "pause nicht bez.",
  );
  const multiValueHeaders = new Set([
    "kommt",
    "geht",
    "abw",
    "pause bez.",
    "pause nicht bez.",
  ]);
  const grouped = new Map<string, ParsedCell[][]>();

  parsed.rows.forEach((row) => {
    const date = extractDateFromCell(row[datumIndex] ?? null);
    if (!date) {
      return;
    }
    const dateKey = dateToKey(date);
    const existing = grouped.get(dateKey);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(dateKey, [row]);
    }
  });
  if (grouped.size === 0) {
    return parsed;
  }

  const rows = Array.from(grouped.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dateKey, groupRows]) => {
      const entries: GroupedEntry[] = groupRows
        .map((row) => ({
          kommt: (kommtIndex === -1
            ? null
            : (row[kommtIndex] ?? null)) as ScalarCell,
          geht: (gehtIndex === -1
            ? null
            : (row[gehtIndex] ?? null)) as ScalarCell,
          abw: (abwIndex === -1 ? null : (row[abwIndex] ?? null)) as ScalarCell,
          pauseBez: (pauseBezIndex === -1
            ? null
            : (row[pauseBezIndex] ?? null)) as ScalarCell,
          pauseNichtBez: (pauseNichtBezIndex === -1
            ? null
            : (row[pauseNichtBezIndex] ?? null)) as ScalarCell,
        }))
        .filter(
          (entry) =>
            !isCellEmpty(entry.kommt) ||
            !isCellEmpty(entry.geht) ||
            !isCellEmpty(entry.abw) ||
            !isCellEmpty(entry.pauseBez) ||
            !isCellEmpty(entry.pauseNichtBez),
        );

      const groupedRow: ParsedCell[] = parsed.headers.map((header, idx) => {
        const normalizedHeader = header.trim().toLowerCase();

        if (idx === datumIndex) {
          return parseIsoDateCell(dateKey);
        }

        if (multiValueHeaders.has(normalizedHeader)) {
          return entries;
        }

        const firstNonEmpty = groupRows.find(
          (row) => !isCellEmpty((row[idx] ?? null) as ScalarCell),
        );
        if (firstNonEmpty) {
          return (firstNonEmpty[idx] ?? null) as ScalarCell;
        }
        return (groupRows[0]?.[idx] ?? null) as ScalarCell;
      });

      return groupedRow;
    });

  return {
    headers: parsed.headers,
    rows,
  };
};

const formatNumber = (n: number): string =>
  Number.isInteger(n)
    ? n.toString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

function App() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [showConstantColumns, setShowConstantColumns] =
    useState<boolean>(false);
  const [tableMode, setTableMode] = useState<TableMode>("full");
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);

  const loadCsvText = (text: string, sourceName: string) => {
    const rawRows = parseCsv(text);
    const parsed = normalizeParsedRows(rawRows);

    if (!parsed) {
      setError("The uploaded CSV appears empty.");
      setData(null);
      setFileName("");
      return;
    }

    const filtered = filterZeileTagRows(parsed);
    const grouped = groupByDatum(filtered);
    setData(grouped);
    setFileName(sourceName);
    setError("");
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setCopied(false);

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      loadCsvText(text, file.name);
    } catch (e) {
      setError("Unable to parse CSV. Please confirm it is valid text CSV.");
      setData(null);
      setFileName("");
    }
  };

  const tableView = useMemo(() => {
    if (!data) {
      return null;
    }

    if (data.rows.length === 0) {
      return {
        constantColumns: [] as ConstantColumn[],
        visibleHeaders: data.headers,
        visibleRows: data.rows,
        rowHasSoll: [] as boolean[],
        rowTimelineOmitted: [] as boolean[],
      };
    }

    const constantIndexes: number[] = [];
    const duplicateDatumIndexes: number[] = [];
    const constantColumns: ConstantColumn[] = [];
    let seenDatum = false;
    const sollIndexInData = data.headers.findIndex(
      (header) => header.trim().toLowerCase() === "soll",
    );
    const rowHasSoll = data.rows.map((row) => {
      if (sollIndexInData === -1) {
        return false;
      }
      return cellToString(row[sollIndexInData] ?? null).trim().length > 0;
    });

    data.headers.forEach((header, idx) => {
      if (header.trim().toLowerCase() === "datum") {
        if (seenDatum) {
          duplicateDatumIndexes.push(idx);
        } else {
          seenDatum = true;
        }
      }

      const firstValueDisplay = cellToDisplayString(
        header,
        data.rows[0]?.[idx] ?? null,
      );
      const allSame = data.rows.every(
        (row) =>
          cellToDisplayString(header, row[idx] ?? null) === firstValueDisplay,
      );

      if (allSame) {
        constantIndexes.push(idx);
        if (firstValueDisplay.trim().length > 0) {
          constantColumns.push({ header, value: firstValueDisplay });
        }
      }
    });

    const hiddenIndexes = new Set<number>([
      ...constantIndexes,
      ...duplicateDatumIndexes,
    ]);
    const baseHeaders = data.headers.filter(
      (_, idx) => !hiddenIndexes.has(idx),
    );
    const baseRows = data.rows.map((row) =>
      row.filter((_, idx) => !hiddenIndexes.has(idx)),
    );

    const kommtIndex = baseHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "kommt",
    );
    const gehtIndex = baseHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "geht",
    );
    const abwIndex = baseHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "abw",
    );

    let visibleHeaders = baseHeaders;
    let visibleRows = baseRows;

    if (kommtIndex !== -1 && gehtIndex !== -1 && abwIndex !== -1) {
      const removeIndexes = new Set<number>([gehtIndex, abwIndex]);
      visibleHeaders = baseHeaders.flatMap((header, idx) => {
        if (idx === kommtIndex) {
          return ["Timeline"];
        }
        if (removeIndexes.has(idx)) {
          return [];
        }
        return [header];
      });

      visibleRows = baseRows.map((row) =>
        row.flatMap((cell, idx) => {
          if (idx === kommtIndex) {
            return [cell];
          }
          if (removeIndexes.has(idx)) {
            return [];
          }
          return [cell];
        }),
      );
    }

    const hiddenByNameIndexes = new Set<number>();
    visibleHeaders.forEach((header, idx) => {
      const normalized = header.trim().toLowerCase();
      if (normalized === "wt" || normalized === "column 18") {
        hiddenByNameIndexes.add(idx);
      }
    });

    if (hiddenByNameIndexes.size > 0) {
      visibleHeaders = visibleHeaders.filter(
        (_, idx) => !hiddenByNameIndexes.has(idx),
      );
      visibleRows = visibleRows.map((row) =>
        row.filter((_, idx) => !hiddenByNameIndexes.has(idx)),
      );
    }

    const datumColumnIndex = visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "datum",
    );
    if (datumColumnIndex !== -1) {
      const datedRows = visibleRows
        .map((row, rowIndex) => {
          const date = extractDateFromCell(row[datumColumnIndex] ?? null);
          if (!date) {
            return null;
          }
          return { key: dateToKey(date), row, hasSoll: rowHasSoll[rowIndex] };
        })
        .filter(
          (
            item,
          ): item is {
            key: string;
            row: ParsedCell[];
            hasSoll: boolean;
          } => item !== null,
        );

      if (datedRows.length > 0) {
        const firstDate = parseIsoDateCell(datedRows[0].key);
        const lastDate = parseIsoDateCell(datedRows[datedRows.length - 1].key);
        if (firstDate && lastDate) {
          const rowMap = new Map<
            string,
            { row: ParsedCell[]; hasSoll: boolean }
          >();
          datedRows.forEach((item) => {
            rowMap.set(item.key, { row: item.row, hasSoll: item.hasSoll });
          });

          const expandedRows: ParsedCell[][] = [];
          const expandedRowHasSoll: boolean[] = [];
          for (
            let current = new Date(
              firstDate.getFullYear(),
              firstDate.getMonth(),
              firstDate.getDate(),
            );
            current.getTime() <= lastDate.getTime();
            current = new Date(
              current.getFullYear(),
              current.getMonth(),
              current.getDate() + 1,
            )
          ) {
            const key = dateToKey(current);
            const existing = rowMap.get(key);
            if (existing) {
              expandedRows.push(existing.row);
              expandedRowHasSoll.push(existing.hasSoll);
            } else {
              expandedRows.push(
                visibleHeaders.map((_, idx) =>
                  idx === datumColumnIndex ? parseIsoDateCell(key) : null,
                ),
              );
              expandedRowHasSoll.push(false);
            }
          }

          visibleRows = expandedRows;
          rowHasSoll.splice(0, rowHasSoll.length, ...expandedRowHasSoll);
        }
      }
    }

    const timelineColumnIndex = visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "timeline",
    );
    const rowTimelineOmitted = visibleRows.map((row, rowIndex) => {
      if (timelineColumnIndex === -1) {
        return false;
      }
      const timelineCell = row[timelineColumnIndex];
      if (!isGroupedEntryArray(timelineCell)) {
        return (
          !rowHasSoll[rowIndex] &&
          cellToString(timelineCell).trim().length === 0
        );
      }
      return shouldOmitTimeline(
        rowHasSoll[rowIndex],
        getTimelineSegments(timelineCell),
      );
    });

    return {
      constantColumns,
      visibleHeaders,
      visibleRows,
      rowHasSoll,
      rowTimelineOmitted,
    };
  }, [data]);

  const availableMonths = useMemo(() => {
    if (!tableView) {
      return [] as string[];
    }
    const datumColumnIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "datum",
    );
    if (datumColumnIndex === -1) {
      return [] as string[];
    }

    const months = new Set<string>();
    tableView.visibleRows.forEach((row) => {
      const date = extractDateFromCell(row[datumColumnIndex] ?? null);
      if (date) {
        months.add(dateToMonthKey(date));
      }
    });

    return Array.from(months).sort();
  }, [tableView]);

  useEffect(() => {
    if (availableMonths.length === 0) {
      setSelectedMonthKey(null);
      return;
    }
    if (!selectedMonthKey || !availableMonths.includes(selectedMonthKey)) {
      setSelectedMonthKey(availableMonths[0]);
    }
  }, [availableMonths, selectedMonthKey]);

  const selectedMonthIndex = useMemo(
    () => (selectedMonthKey ? availableMonths.indexOf(selectedMonthKey) : -1),
    [availableMonths, selectedMonthKey],
  );

  const displayTable = useMemo(() => {
    if (!tableView) {
      return null;
    }
    if (tableMode === "full" || !selectedMonthKey) {
      return {
        visibleRows: tableView.visibleRows,
        rowHasSoll: tableView.rowHasSoll,
        rowTimelineOmitted: tableView.rowTimelineOmitted,
      };
    }

    const datumColumnIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "datum",
    );
    if (datumColumnIndex === -1) {
      return {
        visibleRows: tableView.visibleRows,
        rowHasSoll: tableView.rowHasSoll,
        rowTimelineOmitted: tableView.rowTimelineOmitted,
      };
    }

    const filteredRows: ParsedCell[][] = [];
    const filteredRowHasSoll: boolean[] = [];
    const filteredTimelineOmitted: boolean[] = [];

    tableView.visibleRows.forEach((row, idx) => {
      const date = extractDateFromCell(row[datumColumnIndex] ?? null);
      if (!date || dateToMonthKey(date) !== selectedMonthKey) {
        return;
      }
      filteredRows.push(row);
      filteredRowHasSoll.push(tableView.rowHasSoll[idx]);
      filteredTimelineOmitted.push(tableView.rowTimelineOmitted[idx]);
    });

    return {
      visibleRows: filteredRows,
      rowHasSoll: filteredRowHasSoll,
      rowTimelineOmitted: filteredTimelineOmitted,
    };
  }, [selectedMonthKey, tableMode, tableView]);

  const tableStats = useMemo(() => {
    if (!tableView || !displayTable) {
      return null;
    }

    const datesWithEntries = displayTable.visibleRows.length;
    const sollIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "soll",
    );
    const istIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "ist",
    );

    const totalSoll =
      sollIndex === -1
        ? 0
        : displayTable.visibleRows.reduce(
            (sum, row) =>
              sum + (typeof row[sollIndex] === "number" ? row[sollIndex] : 0),
            0,
          );
    const totalIst =
      istIndex === -1
        ? 0
        : displayTable.visibleRows.reduce(
            (sum, row) =>
              sum + (typeof row[istIndex] === "number" ? row[istIndex] : 0),
            0,
          );
    const timelineIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "timeline",
    );
    const abwMinutes = {
      empty: 0,
      KB: 0,
      p: 0,
      home_hrs: 0,
    };

    if (timelineIndex !== -1) {
      displayTable.visibleRows.forEach((row, rowIndex) => {
        const cell = row[timelineIndex];
        if (!isGroupedEntryArray(cell)) {
          return;
        }
        const segments = getTimelineSegments(cell);
        if (shouldOmitTimeline(displayTable.rowHasSoll[rowIndex], segments)) {
          return;
        }
        segments.forEach((segment) => {
          const duration = segment.end - segment.start;
          const code = segment.abwCode.trim();
          if (code === "") {
            abwMinutes.empty += duration;
          } else if (code === "KB") {
            abwMinutes.KB += duration;
          } else if (code === "p") {
            abwMinutes.p += duration;
          } else if (code === "home_hrs") {
            abwMinutes.home_hrs += duration;
          }
        });
      });
    }

    const totalTrackedMinutes =
      abwMinutes.empty + abwMinutes.KB + abwMinutes.p + abwMinutes.home_hrs;
    const abwSummary: AbwSummaryRow[] = [
      { label: "empty", minutes: abwMinutes.empty, proportion: 0 },
      { label: "KB", minutes: abwMinutes.KB, proportion: 0 },
      { label: "p", minutes: abwMinutes.p, proportion: 0 },
      { label: "home_hrs", minutes: abwMinutes.home_hrs, proportion: 0 },
    ].map((row) => ({
      ...row,
      proportion:
        totalTrackedMinutes > 0 ? row.minutes / totalTrackedMinutes : 0,
    }));

    let taxmanEligibleDays = 0;
    if (timelineIndex !== -1) {
      displayTable.visibleRows.forEach((row, rowIndex) => {
        const cell = row[timelineIndex];
        if (!isGroupedEntryArray(cell)) {
          return;
        }
        const segments = getTimelineSegments(cell);
        if (shouldOmitTimeline(displayTable.rowHasSoll[rowIndex], segments)) {
          return;
        }
        if (segments.length === 0) {
          return;
        }

        const onlyHomeOrP = segments.every((segment) => {
          const code = segment.abwCode.trim();
          return code === "home_hrs" || code === "p";
        });
        if (onlyHomeOrP) {
          taxmanEligibleDays += 1;
        }
      });
    }
    const taxmanDeductionEuros = Math.min(taxmanEligibleDays, 100) * 3;

    return {
      datesWithEntries,
      totalSoll,
      totalIst,
      abwSummary,
      abwTotalMinutes: totalTrackedMinutes,
      taxmanEligibleDays,
      taxmanDeductionEuros,
    };
  }, [displayTable, tableView]);

  const copyTsv = async () => {
    if (!tableView || !displayTable) {
      return;
    }
    if (tableView.visibleHeaders.length === 0) {
      setError("No varying columns to copy.");
      return;
    }

    const headerLine = tableView.visibleHeaders.join("\t");
    const dataLines = displayTable.visibleRows.map((row, rowIndex) =>
      row
        .map((cell, colIndex) => {
          const header = tableView.visibleHeaders[colIndex];
          if (
            header.trim().toLowerCase() === "timeline" &&
            isGroupedEntryArray(cell)
          ) {
            const segments = getTimelineSegments(cell);
            if (
              shouldOmitTimeline(displayTable.rowHasSoll[rowIndex], segments)
            ) {
              return "";
            }
          }
          return cellToDisplayString(header, cell).replace(/\t/g, " ");
        })
        .join("\t"),
    );
    const lines = [headerLine, ...dataLines].join("\n");

    try {
      await navigator.clipboard.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
      setError(
        "Clipboard copy failed. You can still select and copy directly from the table.",
      );
    }
  };

  const renderCellContent = (
    header: string,
    cell: ParsedCell,
    hasSoll: boolean,
  ): ReactNode => {
    if (
      header.trim().toLowerCase() !== "timeline" ||
      !isGroupedEntryArray(cell)
    ) {
      return cellToDisplayString(header, cell);
    }

    const segments = getTimelineSegments(cell);
    if (shouldOmitTimeline(hasSoll, segments)) {
      return "";
    }

    if (segments.length === 0) {
      return (
        <div className="min-w-[260px]">
          <div
            className="relative h-[18px] overflow-hidden rounded-full bg-slate-200"
            role="img"
            aria-label="No time intervals"
          />
        </div>
      );
    }

    const timelineLabel = timelineToText(cell);

    return (
      <div className="min-w-[260px]">
        <div
          className="relative h-[18px] overflow-hidden rounded-full bg-slate-200"
          role="img"
          aria-label={timelineLabel}
        >
          {segments.map((segment, index) => (
            <span
              key={`${segment.start}-${segment.end}-${segment.abwCode}-${index}`}
              className={`absolute inset-y-0 ${segment.colorClass}`}
              title={`${segment.abwCode || "empty"} | ${formatMinutesToTime(segment.start)} - ${formatMinutesToTime(segment.end)}`}
              style={{
                left: `${((segment.start - DAY_START_MINUTES) / DAY_DURATION_MINUTES) * 100}%`,
                width: `${((segment.end - segment.start) / DAY_DURATION_MINUTES) * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <header>
          <h1 className="mb-3 text-2xl font-bold sm:text-3xl">
            Timesheets CSV Viewer
          </h1>
          <p className="mb-3 text-sm text-slate-600 sm:text-base">
            Upload a Sage "Zeitprotokoll" CSV export get summary statistics, and
            pretty timelines for each day.
          </p>
        </header>

        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <label
            htmlFor="csv-upload"
            className="mb-2 inline-block text-sm font-semibold text-slate-700"
          >
            Choose CSV File
          </label>
          <input
            id="csv-upload"
            type="file"
            accept=".csv,text/csv"
            onChange={handleUpload}
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
          />
          {fileName ? (
            <p className="mt-2 text-sm text-slate-900">Loaded: {fileName}</p>
          ) : null}
          {error ? (
            <p className="mt-2 text-sm font-semibold text-red-700">{error}</p>
          ) : null}
        </section>

        {data && tableStats && tableView && displayTable ? (
          <>
            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-xl font-semibold">File Summary</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="mb-1 text-sm font-medium text-slate-600">
                    Dates With Entries
                  </h3>
                  <p className="text-xl font-bold text-slate-900">
                    {formatNumber(tableStats.datesWithEntries)}
                  </p>
                </article>
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="mb-1 text-sm font-medium text-slate-600">
                    Total Soll
                  </h3>
                  <p className="text-xl font-bold text-slate-900">
                    {formatNumber(tableStats.totalSoll)}
                  </p>
                </article>
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h3 className="mb-1 text-sm font-medium text-slate-600">
                    Total IST
                  </h3>
                  <p className="text-xl font-bold text-slate-900">
                    {formatNumber(tableStats.totalIst)}
                  </p>
                </article>
              </div>
              {tableView.constantColumns.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowConstantColumns((v) => !v)}
                    className="mb-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {showConstantColumns ? "Hide" : "Show"} Timesheet Metadata
                  </button>
                  {showConstantColumns ? (
                    <div className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
                      <table className="w-full border-collapse bg-white">
                        <thead>
                          <tr>
                            <th className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold">
                              Column
                            </th>
                            <th className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold">
                              Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {tableView.constantColumns.map((column, idx) => (
                            <tr key={`${column.header}-${idx}`}>
                              <td className="border border-slate-200 px-2 py-2 text-sm align-top">
                                {column.header}
                              </td>
                              <td className="border border-slate-200 px-2 py-2 text-sm align-top">
                                {column.value}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-xl font-semibold">For the taxman</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="mb-1 text-sm font-medium text-slate-600">
                    Days with only home_hrs + p entries
                  </h4>
                  <p className="text-xl font-bold text-slate-900">
                    {formatNumber(tableStats.taxmanEligibleDays)}
                  </p>
                </article>
                <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="mb-1 text-sm font-medium text-slate-600">
                    Deductible Telearbeit (EUR)
                  </h4>
                  <p className="text-xl font-bold text-slate-900">
                    {formatNumber(tableStats.taxmanDeductionEuros)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Calculation: min(days, 100) * 3
                  </p>
                </article>
              </div>
            </section>

            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold">Time entries</h2>
                <div className="ml-0 flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:ml-2">
                  <button
                    type="button"
                    onClick={() => setTableMode("full")}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                      tableMode === "full"
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    All Data
                  </button>
                  <button
                    type="button"
                    onClick={() => setTableMode("monthly")}
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${
                      tableMode === "monthly"
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    Per Month
                  </button>
                </div>
                {tableMode === "monthly" && availableMonths.length > 0 ? (
                  <div className="ml-0 flex items-center gap-2 sm:ml-2">
                    <button
                      type="button"
                      disabled={selectedMonthIndex <= 0}
                      onClick={() => {
                        if (selectedMonthIndex > 0) {
                          setSelectedMonthKey(
                            availableMonths[selectedMonthIndex - 1],
                          );
                        }
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ←
                    </button>
                    <span className="min-w-[130px] text-center text-sm font-semibold text-slate-700">
                      {selectedMonthKey
                        ? monthKeyToLabel(selectedMonthKey)
                        : "No month"}
                    </span>
                    <button
                      type="button"
                      disabled={
                        selectedMonthIndex === -1 ||
                        selectedMonthIndex >= availableMonths.length - 1
                      }
                      onClick={() => {
                        if (
                          selectedMonthIndex >= 0 &&
                          selectedMonthIndex < availableMonths.length - 1
                        ) {
                          setSelectedMonthKey(
                            availableMonths[selectedMonthIndex + 1],
                          );
                        }
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      →
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={copyTsv}
                  className="rounded-lg border border-blue-700 bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Copy as TSV
                </button>
                {copied ? (
                  <span className="text-sm font-semibold text-emerald-700">
                    Copied
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm text-slate-500">
                Tip: You can also select cells in the table and paste directly
                into Excel.
              </p>
              <h3 className="mt-3 mb-2 text-base font-semibold">
                ABW Time Sums
              </h3>
              <div className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full border-collapse bg-white">
                  <thead>
                    <tr>
                      <th className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold">
                        ABW
                      </th>
                      <th className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold">
                        Total Time (hours)
                      </th>
                      <th className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold">
                        Proportion
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableStats.abwSummary.map((row) => (
                      <tr key={row.label}>
                        <td className="border border-slate-200 px-2 py-2 text-sm align-top">
                          {row.label}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-sm align-top">
                          {formatHoursDecimal(row.minutes)}
                        </td>
                        <td className="border border-slate-200 px-2 py-2 text-sm align-top">
                          <span className="inline-flex items-center gap-1">
                            {(row.proportion * 100).toFixed(1)}%
                            {row.label === "home_hrs" ? (
                              <span
                                className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold text-slate-600"
                                title="Average across the entire year, the proportion of home_hrs relative to an empty ABW value must not exceed 40%."
                                aria-label="Home hours proportion rule"
                              >
                                ?
                              </span>
                            ) : null}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                Total Time: {formatHoursDecimal(tableStats.abwTotalMinutes)}
              </p>

              {tableView.visibleHeaders.length === 0 ? (
                <p className="text-sm text-slate-500">
                  All columns are constant across rows, so the detail table is
                  hidden.
                </p>
              ) : (
                <div
                  className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-slate-200"
                  role="region"
                  aria-label="CSV data"
                >
                  <table className="w-full border-collapse bg-white">
                    <thead>
                      <tr>
                        {tableView.visibleHeaders.map((header, idx) => (
                          <th
                            key={`${header}-${idx}`}
                            className="sticky top-0 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold"
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayTable.visibleRows.map((row, rowIndex) => (
                        <tr key={`row-${rowIndex}`}>
                          {row.map((cell, colIndex) => (
                            <td
                              key={`cell-${rowIndex}-${colIndex}`}
                              className={
                                tableView.visibleHeaders[colIndex]
                                  .trim()
                                  .toLowerCase() === "datum" &&
                                displayTable.rowTimelineOmitted[rowIndex]
                                  ? "border border-slate-200 px-2 py-2 text-sm align-top text-slate-500"
                                  : "border border-slate-200 px-2 py-2 text-sm align-top"
                              }
                            >
                              {renderCellContent(
                                tableView.visibleHeaders[colIndex],
                                cell,
                                displayTable.rowHasSoll[rowIndex],
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default App;
