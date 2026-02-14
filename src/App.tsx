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
  ist: ScalarCell;
  abw: ScalarCell;
  feiertagMarker: ScalarCell;
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
type ViewMode = "complete" | "year" | "month";
type VisibleTableSlice = {
  visibleRows: ParsedCell[][];
  rowHasSoll: boolean[];
  rowTimelineOmitted: boolean[];
};
type TableStats = {
  datesWithEntries: number;
  daysWithIstEntries: number;
  totalSoll: number;
  totalIst: number;
  totalPEntries: number;
  abwSummary: AbwSummaryRow[];
  abwTotalMinutes: number;
  taxmanEligibleDays: number;
  taxmanDeductionEuros: number;
  kbOnlyDays: number;
  uOnlyDays: number;
  homeOfficeDays: number;
  officeDays: number;
  homeOfficeSharePessimistic: number;
  homeOfficeShareOptimistic: number;
  recordedHoursBreakdown: {
    pauseNichtBez: number;
    pauseBez: number;
    istAbwEmpty: number;
    istAbwHomeHrs: number;
    istAbwKb: number;
    istAbwU: number;
  };
};

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
  });
};

const formatDateLabel = (date: Date): string =>
  date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

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
  const feiertagMarkerIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "column 18",
  );
  const istIndex = parsed.headers.findIndex(
    (header) => header.trim().toLowerCase() === "ist",
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
          ist: (istIndex === -1 ? null : (row[istIndex] ?? null)) as ScalarCell,
          abw: (abwIndex === -1 ? null : (row[abwIndex] ?? null)) as ScalarCell,
          feiertagMarker: (feiertagMarkerIndex === -1
            ? null
            : (row[feiertagMarkerIndex] ?? null)) as ScalarCell,
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
            !isCellEmpty(entry.ist) ||
            !isCellEmpty(entry.abw) ||
            !isCellEmpty(entry.feiertagMarker) ||
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

const calculateTableStats = (
  visibleHeaders: string[],
  tableSlice: VisibleTableSlice,
): TableStats => {
  const datesWithEntries = tableSlice.visibleRows.length;
  const sollIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "soll",
  );
  const istIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "ist",
  );
  const pauseBezIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "pause bez.",
  );
  const timelineIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "timeline",
  );

  const totalSoll =
    sollIndex === -1
      ? 0
      : tableSlice.visibleRows.reduce(
          (sum, row) =>
            sum + (typeof row[sollIndex] === "number" ? row[sollIndex] : 0),
          0,
        );
  const totalIst = tableSlice.visibleRows.reduce((sum, row) => {
    const istFromRow = istIndex !== -1 && typeof row[istIndex] === "number"
      ? row[istIndex]
      : 0;
    const pauseBezFromRow =
      pauseBezIndex !== -1 && typeof row[pauseBezIndex] === "number"
        ? row[pauseBezIndex]
        : 0;
    const timelineCell = timelineIndex === -1 ? null : row[timelineIndex];
    if (isGroupedEntryArray(timelineCell)) {
      const totals = timelineCell.reduce(
        (acc, entry) => {
          if (typeof entry.ist === "number") {
            acc.ist += entry.ist;
          }
          if (typeof entry.pauseBez === "number") {
            acc.pauseBez += entry.pauseBez;
          }
          return acc;
        },
        { ist: 0, pauseBez: 0 },
      );
      return sum + totals.ist + totals.pauseBez;
    }
    return sum + istFromRow + pauseBezFromRow;
  }, 0);
  const datumIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "datum",
  );
  const abwIndex = visibleHeaders.findIndex(
    (header) => header.trim().toLowerCase() === "abw",
  );
  const abwMinutes = {
    empty: 0,
    KB: 0,
    p: 0,
    home_hrs: 0,
  };

  if (timelineIndex !== -1) {
    tableSlice.visibleRows.forEach((row, rowIndex) => {
      const cell = row[timelineIndex];
      if (!isGroupedEntryArray(cell)) {
        return;
      }
      const segments = getTimelineSegments(cell);
      if (shouldOmitTimeline(tableSlice.rowHasSoll[rowIndex], segments)) {
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
    proportion: totalTrackedMinutes > 0 ? row.minutes / totalTrackedMinutes : 0,
  }));

  let taxmanEligibleDays = 0;
  let totalPEntries = 0;
  let kbOnlyDays = 0;
  let uOnlyDays = 0;
  let daysWithIstEntries = 0;
  let homeOfficeDays = 0;
  let officeDays = 0;
  let pauseNichtBez = 0;
  let pauseBez = 0;
  let istAbwEmpty = 0;
  let istAbwHomeHrs = 0;
  let pauseBezForP = 0;
  let istAbwKb = 0;
  let istAbwU = 0;
  if (timelineIndex === -1 && istIndex !== -1) {
    daysWithIstEntries = tableSlice.visibleRows.reduce(
      (sum, row) => sum + (typeof row[istIndex] === "number" ? 1 : 0),
      0,
    );
  }
  if (timelineIndex !== -1) {
    tableSlice.visibleRows.forEach((row, rowIndex) => {
      const cell = row[timelineIndex];
      const rowDate = extractDateFromCell(
        datumIndex === -1 ? null : (row[datumIndex] ?? null),
      );
      const rowDateLabel = rowDate ? dateToKey(rowDate) : `row-${rowIndex + 1}`;

      if (!isGroupedEntryArray(cell)) {
        if (istIndex !== -1 && typeof row[istIndex] === "number") {
          const abwCode =
            abwIndex === -1 ? "" : cellToString(row[abwIndex] ?? null).trim();
          if (abwCode.length === 0) {
            daysWithIstEntries += 1;
            officeDays += 1;
          } else if (abwCode === "home_hrs") {
            daysWithIstEntries += 1;
            homeOfficeDays += 1;
          } else if (abwCode === "KB" && tableSlice.rowHasSoll[rowIndex]) {
            daysWithIstEntries += 1;
            kbOnlyDays += 1;
          } else if (abwCode === "U") {
            daysWithIstEntries += 1;
            uOnlyDays += 1;
          } else {
            daysWithIstEntries += 1;
            console.warn(
              `[Timesheets] Day "${rowDateLabel}" classified as Other (ABW: ${abwCode || "empty"})`,
            );
          }
        }
        return;
      }
      const numericIstEntries = cell.filter(
        (entry) => typeof entry.ist === "number",
      );
      cell.forEach((entry) => {
        const abwCode = cellToString(entry.abw).trim();
        if (typeof entry.pauseNichtBez === "number") {
          pauseNichtBez += entry.pauseNichtBez;
        }
        if (typeof entry.pauseBez === "number") {
          pauseBez += entry.pauseBez;
        }
        if (abwCode === "p" && typeof entry.pauseBez === "number") {
          pauseBezForP += entry.pauseBez;
        }
        if (typeof entry.ist === "number") {
          if (abwCode.length === 0) {
            istAbwEmpty += entry.ist;
          } else if (abwCode === "home_hrs") {
            istAbwHomeHrs += entry.ist;
          } else if (abwCode === "KB") {
            istAbwKb += entry.ist;
          } else if (abwCode === "U") {
            istAbwU += entry.ist;
          }
        }
      });
      const allAbwCodes = cell.map((entry) => cellToString(entry.abw).trim());
      totalPEntries += allAbwCodes.filter((code) => code === "p").length;

      const abwCodes = numericIstEntries.map((entry) =>
        cellToString(entry.abw).trim(),
      );
      if (abwCodes.length > 0) {
        const hasFeiertagMarker = cell.some(
          (entry) => cellToString(entry.feiertagMarker).trim().length > 0,
        );
        const isNonWorkDay =
          abwCodes.length === 1 && abwCodes[0].length === 0 && hasFeiertagMarker;
        const hasOfficeIstEntry = numericIstEntries.some(
          (entry) => cellToString(entry.abw).trim().length === 0,
        );
        const isKrankenstandDay =
          tableSlice.rowHasSoll[rowIndex] &&
          abwCodes.every((code) => code === "KB");
        const isUrlaubDay = abwCodes.every((code) => code === "U");
        const isHomeOfficeDay =
          allAbwCodes.includes("home_hrs") &&
          allAbwCodes.every((code) => code === "home_hrs" || code === "p");
        const isOfficeDay =
          hasOfficeIstEntry || allAbwCodes.some((code) => code.length === 0);

        if (isKrankenstandDay) {
          daysWithIstEntries += 1;
          kbOnlyDays += 1;
        } else if (isUrlaubDay) {
          daysWithIstEntries += 1;
          uOnlyDays += 1;
        } else if (isNonWorkDay) {
          // intentionally excluded from office/home counts
        } else if (isOfficeDay) {
          daysWithIstEntries += 1;
          officeDays += 1;
        } else if (isHomeOfficeDay) {
          daysWithIstEntries += 1;
          homeOfficeDays += 1;
        } else {
          daysWithIstEntries += 1;
          console.warn(
            `[Timesheets] Day "${rowDateLabel}" classified as Other (ABW codes: ${abwCodes.join(", ")})`,
          );
        }
      }
    });
  }
  taxmanEligibleDays = homeOfficeDays;
  const taxmanDeductionEuros = Math.min(taxmanEligibleDays, 100) * 3;
  const homeOfficeSharePessimisticDenominator = istAbwHomeHrs + istAbwEmpty;
  const homeOfficeSharePessimistic =
    homeOfficeSharePessimisticDenominator > 0
      ? istAbwHomeHrs / homeOfficeSharePessimisticDenominator
      : 0;
  const homeOfficeShareOptimisticDenominator =
    istAbwHomeHrs + istAbwEmpty + pauseBezForP + istAbwKb + istAbwU;
  const homeOfficeShareOptimistic =
    homeOfficeShareOptimisticDenominator > 0
      ? istAbwHomeHrs / homeOfficeShareOptimisticDenominator
      : 0;

  return {
    datesWithEntries,
    daysWithIstEntries,
    totalSoll,
    totalIst,
    totalPEntries,
    abwSummary,
    abwTotalMinutes: totalTrackedMinutes,
    taxmanEligibleDays,
    taxmanDeductionEuros,
    kbOnlyDays,
    uOnlyDays,
    homeOfficeDays,
    officeDays,
    homeOfficeSharePessimistic,
    homeOfficeShareOptimistic,
    recordedHoursBreakdown: {
      pauseNichtBez,
      pauseBez,
      istAbwEmpty,
      istAbwHomeHrs,
      istAbwKb,
      istAbwU,
    },
  };
};

type SummaryStatisticsProps = {
  dateRangeLabel: string;
  daysWithIstEntries: number;
  totalSollHours: number;
  totalIstHours: number;
  totalPEntries: number;
  kbOnlyDays: number;
  uOnlyDays: number;
  homeOfficeDays: number;
  officeDays: number;
  homeOfficeSharePessimistic: number;
  homeOfficeShareOptimistic: number;
  recordedHoursBreakdown: TableStats["recordedHoursBreakdown"];
};

const SummaryStatistics = ({
  dateRangeLabel,
  daysWithIstEntries,
  totalSollHours,
  totalIstHours,
  totalPEntries,
  kbOnlyDays,
  uOnlyDays,
  homeOfficeDays,
  officeDays,
  homeOfficeSharePessimistic,
  homeOfficeShareOptimistic,
  recordedHoursBreakdown,
}: SummaryStatisticsProps) => {
  const [rangeStart, rangeEnd] = dateRangeLabel.split(" - ");
  return (
    <div className="mt-3 space-y-3">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">Date Range</h3>
        <p className="text-sm font-semibold text-slate-900 text-right">{rangeStart}</p>
        <p className="text-sm font-semibold text-slate-900 text-right">
          {rangeEnd ?? rangeStart}
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">Days</h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(daysWithIstEntries)}
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">Office Days</h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(officeDays)}
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          Home Office Days
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(homeOfficeDays)}
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          Krankenstand
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(kbOnlyDays)}
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          Urlaubstage
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(uOnlyDays)}
        </p>
      </article>
    </div>
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">
        Recorded Hours Breakdown
      </h3>
      {(() => {
        const segments = [
          {
            label: "Pause nicht bez.",
            value: recordedHoursBreakdown.pauseNichtBez,
            colorClass: "bg-slate-600",
          },
          {
            label: "Pause bez.",
            value: recordedHoursBreakdown.pauseBez,
            colorClass: "bg-slate-400",
          },
          {
            label: "Office",
            value: recordedHoursBreakdown.istAbwEmpty,
            colorClass: "bg-green-600",
          },
          {
            label: "Home",
            value: recordedHoursBreakdown.istAbwHomeHrs,
            colorClass: "bg-blue-600",
          },
          {
            label: "Krankenstand",
            value: recordedHoursBreakdown.istAbwKb,
            colorClass: "bg-red-950",
          },
          {
            label: "Urlaub",
            value: recordedHoursBreakdown.istAbwU,
            colorClass: "bg-slate-500",
          },
        ];
        const total = segments.reduce((sum, segment) => sum + segment.value, 0);
        const minimumVisualTotal =
          recordedHoursBreakdown.pauseNichtBez + totalSollHours;
        const minBracketInsetPercent = 5;
        const sollBracketMaxPercent = 100 - minBracketInsetPercent;
        const minimumForSollSpacing =
          sollBracketMaxPercent > 0
            ? minimumVisualTotal / (sollBracketMaxPercent / 100)
            : minimumVisualTotal;
        const displayTotal = Math.max(total, minimumForSollSpacing, 0);
        const firstLinePercentRaw =
          displayTotal > 0
            ? (recordedHoursBreakdown.pauseNichtBez / displayTotal) * 100
            : 0;
        const secondLinePercentRaw =
          displayTotal > 0
            ? Math.min(
                100,
                firstLinePercentRaw + (totalSollHours / displayTotal) * 100,
              )
            : 0;
        const leftSpacerPercent =
          firstLinePercentRaw < minBracketInsetPercent
            ? (100 * (minBracketInsetPercent - firstLinePercentRaw)) /
              (100 - firstLinePercentRaw)
            : 0;
        const scaledContentPercent = 100 - leftSpacerPercent;
        const firstLinePercent =
          leftSpacerPercent + (firstLinePercentRaw * scaledContentPercent) / 100;
        const secondLinePercent =
          leftSpacerPercent + (secondLinePercentRaw * scaledContentPercent) / 100;
        const totalFilledPercent =
          leftSpacerPercent +
          (displayTotal > 0 ? (total / displayTotal) * scaledContentPercent : 0);
        const missingToSollPercent = Math.max(
          0,
          secondLinePercent - totalFilledPercent,
        );
        const rightOutsidePercent = Math.max(
          0,
          100 - Math.max(secondLinePercent, totalFilledPercent),
        );
        const missingHoursToSoll =
          minimumVisualTotal > total ? minimumVisualTotal - total : 0;
        return (
          <>
            <div className="relative">
              <div className="h-4 overflow-hidden rounded-full bg-slate-200">
                <div className="flex h-full w-full">
                  {leftSpacerPercent > 0 ? (
                    <span
                      className="bg-slate-100"
                      title="Left spacing before Soll range"
                      style={{ width: `${leftSpacerPercent}%` }}
                    />
                  ) : null}
                  {displayTotal > 0
                    ? segments.map((segment) => (
                        <span
                          key={segment.label}
                          className={segment.colorClass}
                          title={`${segment.label}: ${formatNumber(segment.value)} h`}
                          style={{
                            width: `${((segment.value / displayTotal) * scaledContentPercent)}%`,
                          }}
                        />
                      ))
                    : null}
                {missingToSollPercent > 0 ? (
                  <span
                    className="bg-red-100"
                    title={`Missing hours to reach Soll range: ${formatNumber(missingHoursToSoll)} h`}
                    style={{
                      width: `${missingToSollPercent}%`,
                      backgroundImage:
                        "repeating-linear-gradient(135deg, rgba(220,38,38,0.45) 0 4px, rgba(220,38,38,0.12) 4px 8px)",
                    }}
                  />
                ) : null}
                {rightOutsidePercent > 0 ? (
                  <span
                    className="bg-slate-100"
                    title="Outside Soll range"
                    style={{ width: `${rightOutsidePercent}%` }}
                  />
                ) : null}
                </div>
              </div>
              {displayTotal > 0 ? (
                <>
                  <span
                    className="pointer-events-none absolute -top-2 bottom-[-0.5rem] w-[2px] bg-red-600"
                    style={{ left: `${firstLinePercent}%` }}
                    title='Border between "Pause nicht bez." and "Pause bez."'
                  >
                    <span className="absolute top-0 left-0 h-[2px] w-[8px] bg-red-600" />
                    <span className="absolute bottom-0 left-0 h-[2px] w-[8px] bg-red-600" />
                  </span>
                  <span
                    className="pointer-events-none absolute -top-2 bottom-[-0.5rem] w-[2px] bg-red-600"
                    style={{ left: `${secondLinePercent}%` }}
                    title="Soll hours target from first marker"
                  >
                    <span className="absolute top-0 right-0 h-[2px] w-[8px] bg-red-600" />
                    <span className="absolute bottom-0 right-0 h-[2px] w-[8px] bg-red-600" />
                  </span>
                </>
              ) : null}
            </div>
          </>
        );
      })()}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-600" />
            Pause nicht bez.
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.pauseNichtBez)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" />
            Pause bez.
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.pauseBez)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-600" />
            Office
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.istAbwEmpty)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" />
            Home
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.istAbwHomeHrs)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-950" />
            Krankenstand
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.istAbwKb)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-500" />
            Urlaub
          </span>
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(recordedHoursBreakdown.istAbwU)} h
        </p>
      </article>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">Soll</h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(totalSollHours)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">Ist</h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {formatNumber(totalIstHours)} h
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          % Home Hours (strict)
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {(homeOfficeSharePessimistic * 100).toFixed(1)}%
        </p>
      </article>
      <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <h3 className="mb-1 text-sm font-medium text-slate-600">
          % Home Hours (optimistic)
        </h3>
        <p className="text-xl font-bold text-slate-900 text-right">
          {(homeOfficeShareOptimistic * 100).toFixed(1)}%
        </p>
      </article>
    </div>
    </div>
  );
};

function App() {
  const [data, setData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  const [showConstantColumns, setShowConstantColumns] =
    useState<boolean>(false);
  const [viewMode, setViewMode] = useState<ViewMode>("complete");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [hasOpenedYearView, setHasOpenedYearView] = useState<boolean>(false);
  const [hasOpenedMonthView, setHasOpenedMonthView] = useState<boolean>(false);

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
    setHasOpenedYearView(false);
    setHasOpenedMonthView(false);
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

  const availableYears = useMemo(() => {
    if (!tableView) {
      return [] as number[];
    }
    const datumColumnIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "datum",
    );
    if (datumColumnIndex === -1) {
      return [] as number[];
    }

    const years = new Set<number>();
    tableView.visibleRows.forEach((row) => {
      const date = extractDateFromCell(row[datumColumnIndex] ?? null);
      if (date) {
        years.add(date.getFullYear());
      }
    });

    return Array.from(years).sort((a, b) => a - b);
  }, [tableView]);

  useEffect(() => {
    if (availableYears.length === 0) {
      setSelectedYear(null);
      return;
    }
    if (selectedYear === null || !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    if (viewMode !== "year" || hasOpenedYearView || availableYears.length === 0) {
      return;
    }
    setSelectedYear(availableYears[availableYears.length - 1]);
    setHasOpenedYearView(true);
  }, [availableYears, hasOpenedYearView, viewMode]);

  const selectedYearIndex = useMemo(
    () => (selectedYear === null ? -1 : availableYears.indexOf(selectedYear)),
    [availableYears, selectedYear],
  );

  const yearFilteredTable = useMemo(() => {
    if (!tableView) {
      return null;
    }

    if (selectedYear === null) {
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
      if (!date || date.getFullYear() !== selectedYear) {
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
  }, [selectedYear, tableView]);

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

  useEffect(() => {
    if (
      viewMode !== "month" ||
      hasOpenedMonthView ||
      availableMonths.length === 0
    ) {
      return;
    }
    setSelectedMonthKey(availableMonths[availableMonths.length - 1]);
    setHasOpenedMonthView(true);
  }, [availableMonths, hasOpenedMonthView, viewMode]);

  const selectedMonthIndex = useMemo(
    () => (selectedMonthKey ? availableMonths.indexOf(selectedMonthKey) : -1),
    [availableMonths, selectedMonthKey],
  );

  const monthFilteredTable = useMemo(() => {
    if (!tableView) {
      return null;
    }
    if (!selectedMonthKey) {
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
  }, [selectedMonthKey, tableView]);

  const activeTable = useMemo(() => {
    if (!tableView) {
      return null;
    }
    if (viewMode === "year") {
      return yearFilteredTable;
    }
    if (viewMode === "month") {
      return monthFilteredTable;
    }
    return {
      visibleRows: tableView.visibleRows,
      rowHasSoll: tableView.rowHasSoll,
      rowTimelineOmitted: tableView.rowTimelineOmitted,
    };
  }, [monthFilteredTable, tableView, viewMode, yearFilteredTable]);

  const activeSummary = useMemo(() => {
    if (!tableView || !activeTable) {
      return null;
    }
    const datumIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "datum",
    );
    if (datumIndex === -1) {
      return {
        dateRangeLabel: "No date column found",
        entryCount: activeTable.visibleRows.length,
      };
    }

    const dates = activeTable.visibleRows
      .map((row) => extractDateFromCell(row[datumIndex] ?? null))
      .filter((date): date is Date => date !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    if (dates.length === 0) {
      return {
        dateRangeLabel: "No valid dates found",
        entryCount: 0,
      };
    }

    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    const dateRangeLabel =
      firstDate.getTime() === lastDate.getTime()
        ? formatDateLabel(firstDate)
        : `${formatDateLabel(firstDate)} - ${formatDateLabel(lastDate)}`;

    return {
      dateRangeLabel,
      entryCount: dates.length,
    };
  }, [activeTable, tableView]);

  const activeStats = useMemo(() => {
    if (!tableView || !activeTable) {
      return null;
    }
    return calculateTableStats(tableView.visibleHeaders, activeTable);
  }, [activeTable, tableView]);

  const selectedPeriodConstantColumns = useMemo(() => {
    if (!tableView || !activeTable) {
      return [] as ConstantColumn[];
    }

    const constantsByHeader = new Map<string, string>();
    tableView.constantColumns.forEach((column) => {
      constantsByHeader.set(column.header, column.value);
    });

    tableView.visibleHeaders.forEach((header, idx) => {
      const firstValueDisplay = cellToDisplayString(
        header,
        activeTable.visibleRows[0]?.[idx] ?? null,
      );
      const allSame = activeTable.visibleRows.every(
        (row) => cellToDisplayString(header, row[idx] ?? null) === firstValueDisplay,
      );
      if (allSame && firstValueDisplay.trim().length > 0) {
        constantsByHeader.set(header, firstValueDisplay);
      }
    });

    return Array.from(constantsByHeader.entries()).map(([header, value]) => ({
      header,
      value,
    }));
  }, [activeTable, tableView]);

  const copyTsv = async () => {
    if (!tableView || !activeTable) {
      return;
    }
    if (tableView.visibleHeaders.length < 2) {
      setError("Need at least two visible columns to copy.");
      return;
    }

    const dataLines = activeTable.visibleRows.map((row, rowIndex) =>
      [0, 1]
        .map((colIndex) => {
          const header = tableView.visibleHeaders[colIndex];
          const cell = row[colIndex] ?? null;
          if (
            header.trim().toLowerCase() === "timeline" &&
            isGroupedEntryArray(cell)
          ) {
            const segments = getTimelineSegments(cell);
            if (
              shouldOmitTimeline(activeTable.rowHasSoll[rowIndex], segments)
            ) {
              return "";
            }
          }
          return cellToDisplayString(header, cell).replace(/\t/g, " ");
        })
        .join("\t"),
    );
    const lines = dataLines.join("\n");

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
            className="relative z-0 h-[18px] overflow-hidden rounded-full bg-slate-200"
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
          className="relative z-0 h-[18px] overflow-hidden rounded-full bg-slate-200"
          role="img"
          aria-label={timelineLabel}
        >
          {segments.map((segment, index) => (
            <span
              key={`${segment.start}-${segment.end}-${segment.abwCode}-${index}`}
              className={`absolute inset-y-0 z-0 ${segment.colorClass}`}
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

  const dailyRecordsTable = useMemo(() => {
    if (!tableView || !activeTable) {
      return null;
    }

    const timelineIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "timeline",
    );
    const istIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "ist",
    );
    const abwIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "abw",
    );

    const classifyRowType = (row: ParsedCell[], rowIndex: number): string => {
      if (timelineIndex !== -1 && isGroupedEntryArray(row[timelineIndex])) {
        const entries = row[timelineIndex];
        const numericIstEntries = entries.filter(
          (entry) => typeof entry.ist === "number",
        );
        if (numericIstEntries.length === 0) {
          return "";
        }
        const numericAbwCodes = numericIstEntries.map((entry) =>
          cellToString(entry.abw).trim(),
        );
        const allAbwCodes = entries.map((entry) => cellToString(entry.abw).trim());
        const hasFeiertagMarker = entries.some(
          (entry) => cellToString(entry.feiertagMarker).trim().length > 0,
        );
        const isNonWorkDay =
          numericAbwCodes.length === 1 &&
          numericAbwCodes[0].length === 0 &&
          hasFeiertagMarker;
        const hasOfficeIstEntry = numericAbwCodes.some(
          (code) => code.length === 0,
        );
        const hasAnyOfficeEntry = allAbwCodes.some((code) => code.length === 0);
        if (
          activeTable.rowHasSoll[rowIndex] &&
          numericAbwCodes.every((code) => code === "KB")
        ) {
          return "Krankenstand";
        }
        if (numericAbwCodes.every((code) => code === "U")) {
          return "Urlaub";
        }
        if (isNonWorkDay) {
          return "Non-work day";
        }
        if (hasOfficeIstEntry || hasAnyOfficeEntry) {
          return "Office";
        }
        if (
          allAbwCodes.includes("home_hrs") &&
          allAbwCodes.every((code) => code === "home_hrs" || code === "p")
        ) {
          return "Home";
        }
        return "Other";
      }

      if (istIndex !== -1 && typeof row[istIndex] === "number") {
        const abwCode =
          abwIndex === -1 ? "" : cellToString(row[abwIndex] ?? null).trim();
        if (activeTable.rowHasSoll[rowIndex] && abwCode === "KB") {
          return "Krankenstand";
        }
        if (abwCode === "U") {
          return "Urlaub";
        }
        if (abwCode.length === 0) {
          return "Office";
        }
        if (abwCode === "home_hrs" || abwCode === "p") {
          return "Home";
        }
        return "Other";
      }

      return "";
    };

    const getHomeOfficeIstSums = (
      row: ParsedCell[],
    ): { home: number; office: number } => {
      if (timelineIndex !== -1 && isGroupedEntryArray(row[timelineIndex])) {
        return row[timelineIndex].reduce(
          (acc, entry) => {
            if (!isTimeOfDayCell(entry.kommt) || !isTimeOfDayCell(entry.geht)) {
              return acc;
            }
            const durationMinutes = entry.geht.minutes - entry.kommt.minutes;
            if (durationMinutes <= 0) {
              return acc;
            }
            const durationHours = durationMinutes / 60;
            const abwCode = cellToString(entry.abw).trim();
            if (abwCode === "home_hrs") {
              acc.home += durationHours;
            } else if (abwCode.length === 0) {
              acc.office += durationHours;
            }
            return acc;
          },
          { home: 0, office: 0 },
        );
      }

      return { home: 0, office: 0 };
    };

    const headersWithType =
      tableView.visibleHeaders.length > 0
        ? [tableView.visibleHeaders[0], "Type", ...tableView.visibleHeaders.slice(1)]
        : ["Type"];

    const normalizedHeadersWithType = headersWithType.map((header) =>
      header.trim().toLowerCase(),
    );
    const moveIndexAfter = (
      indexes: number[],
      fromHeader: string,
      toHeader: string,
    ): number[] => {
      const fromPos = indexes.findIndex(
        (idx) => normalizedHeadersWithType[idx] === fromHeader,
      );
      const toPos = indexes.findIndex(
        (idx) => normalizedHeadersWithType[idx] === toHeader,
      );
      if (fromPos === -1 || toPos === -1) {
        return indexes;
      }
      const moved = [...indexes];
      const [fromIdx] = moved.splice(fromPos, 1);
      const updatedToPos = moved.findIndex(
        (idx) => normalizedHeadersWithType[idx] === toHeader,
      );
      moved.splice(updatedToPos + 1, 0, fromIdx);
      return moved;
    };

    let reorderedIndexes = headersWithType.map((_, idx) => idx);
    reorderedIndexes = moveIndexAfter(
      reorderedIndexes,
      "ist",
      "pause nicht bez.",
    );
    reorderedIndexes = moveIndexAfter(reorderedIndexes, "soll", "ist");

    const reorderedHeaders = reorderedIndexes.map((idx) => headersWithType[idx]);
    const istIndexInDailyHeaders = reorderedHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "ist",
    );
    const sollIndexInDailyHeaders = reorderedHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "soll",
    );
    const insertHomeOfficeAt =
      sollIndexInDailyHeaders !== -1
        ? sollIndexInDailyHeaders + 1
        : istIndexInDailyHeaders === -1
          ? reorderedHeaders.length
          : istIndexInDailyHeaders + 1;

    const headers = [
      ...reorderedHeaders.slice(0, insertHomeOfficeAt),
      "home",
      "office",
      ...reorderedHeaders.slice(insertHomeOfficeAt),
    ];

    const rows = activeTable.visibleRows.map((row, rowIndex) => {
      const typeCell = classifyRowType(row, rowIndex);
      const sums = getHomeOfficeIstSums(row);
      const displayHome = sums.home === 0 ? null : sums.home;
      const displayOffice = sums.office === 0 ? null : sums.office;
      const rowWithType = [row[0], typeCell, ...row.slice(1)] as ParsedCell[];
      const reorderedRow = reorderedIndexes.map((idx) => rowWithType[idx]);
      if (row.length === 0) {
        return [typeCell] as ParsedCell[];
      }
      return [
        ...reorderedRow.slice(0, insertHomeOfficeAt),
        displayHome,
        displayOffice,
        ...reorderedRow.slice(insertHomeOfficeAt),
      ] as ParsedCell[];
    });

    return { headers, rows };
  }, [activeTable, tableView]);

  const dailyRecordsNumericColumnIndexes = useMemo(() => {
    if (!dailyRecordsTable) {
      return new Set<number>();
    }
    const indexes = new Set<number>();
    const numericHeaderNames = new Set([
      "soll",
      "ist",
      "pause bez.",
      "pause nicht bez.",
      "home",
      "office",
    ]);
    dailyRecordsTable.headers.forEach((_, colIndex) => {
      const normalizedHeader = dailyRecordsTable.headers[colIndex]
        .trim()
        .toLowerCase();
      if (
        numericHeaderNames.has(normalizedHeader) ||
        normalizedHeader.startsWith("gesamt")
      ) {
        indexes.add(colIndex);
        return;
      }
      const hasNumeric = dailyRecordsTable.rows.some(
        (row) => typeof row[colIndex] === "number",
      );
      if (hasNumeric) {
        indexes.add(colIndex);
      }
    });
    return indexes;
  }, [dailyRecordsTable]);

  const istMismatchByRow = useMemo(() => {
    if (!tableView || !activeTable) {
      return [] as boolean[];
    }
    const istIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "ist",
    );
    const timelineIndex = tableView.visibleHeaders.findIndex(
      (header) => header.trim().toLowerCase() === "timeline",
    );
    if (istIndex === -1 || timelineIndex === -1) {
      return activeTable.visibleRows.map(() => false);
    }

    return activeTable.visibleRows.map((row) => {
      const istValue = row[istIndex];
      const timelineCell = row[timelineIndex];
      if (typeof istValue !== "number" || !isGroupedEntryArray(timelineCell)) {
        return false;
      }

      let homeHours = 0;
      let officeHours = 0;
      let kbHours = 0;
      let uHours = 0;
      let pauseBez = 0;
      let totalFeiertagEntryHours = 0;
      let hasFeiertagMarker = false;
      timelineCell.forEach((entry) => {
        const feiertagMarked =
          cellToString(entry.feiertagMarker).trim().length > 0;
        if (feiertagMarked) {
          hasFeiertagMarker = true;
        }
        if (isTimeOfDayCell(entry.kommt) && isTimeOfDayCell(entry.geht)) {
          const durationMinutes = entry.geht.minutes - entry.kommt.minutes;
          if (durationMinutes > 0) {
            const durationHours = durationMinutes / 60;
            if (feiertagMarked) {
              totalFeiertagEntryHours += durationHours;
            }
            const abwCode = cellToString(entry.abw).trim();
            if (abwCode === "home_hrs") {
              homeHours += durationHours;
            } else if (abwCode === "KB") {
              kbHours += durationHours;
            } else if (abwCode === "U") {
              uHours += durationHours;
            } else if (abwCode.length === 0) {
              officeHours += durationHours;
            }
          }
        } else if (feiertagMarked && typeof entry.ist === "number") {
          // Feiertag rows can carry credited IST without explicit start/end times.
          totalFeiertagEntryHours += entry.ist;
        }
        if (typeof entry.pauseBez === "number") {
          pauseBez += entry.pauseBez;
        }
      });

      const baseHours = hasFeiertagMarker
        ? totalFeiertagEntryHours
        : homeHours + officeHours + kbHours + uHours;
      const expectedIst = baseHours + pauseBez;
      return Math.abs(istValue - expectedIst) > 0.01;
    });
  }, [activeTable, tableView]);

  const dailyRecordsIstIndex = useMemo(() => {
    if (!dailyRecordsTable) {
      return -1;
    }
    return dailyRecordsTable.headers.findIndex(
      (header) => header.trim().toLowerCase() === "ist",
    );
  }, [dailyRecordsTable]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <h1 className="mb-3 text-2xl font-bold sm:text-3xl">
            Timesheets CSV Viewer
          </h1>
          <p className="mb-3 text-sm text-slate-600 sm:text-base">
            Upload a Sage "Zeitprotokoll" CSV export get summary statistics, and
            pretty timelines for each day.
          </p>
          <p className="mb-3 text-sm text-slate-600 sm:text-base">
            All analysis happens locally in your browser, the data never leaves
            your computer.
          </p>
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

        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid w-full grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setViewMode("complete")}
              className={`w-full rounded-md px-3 py-1 text-sm font-semibold ${
                viewMode === "complete"
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Complete File
            </button>
            <button
              type="button"
              onClick={() => setViewMode("year")}
              className={`w-full rounded-md px-3 py-1 text-sm font-semibold ${
                viewMode === "year"
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Year
            </button>
            <button
              type="button"
              onClick={() => setViewMode("month")}
              className={`w-full rounded-md px-3 py-1 text-sm font-semibold ${
                viewMode === "month"
                  ? "bg-slate-800 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              Month
            </button>
          </div>

          {data && activeSummary && activeStats && tableView && activeTable ? (
            <>
              {viewMode === "year" ? (
                <div className="mt-4 grid grid-cols-[40px_1fr_40px] items-center gap-2">
                  <button
                    type="button"
                    disabled={availableYears.length <= 1 || selectedYearIndex <= 0}
                    onClick={() => {
                      if (selectedYearIndex > 0) {
                        setSelectedYear(availableYears[selectedYearIndex - 1]);
                      }
                    }}
                    className={`rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 ${
                      availableYears.length <= 1 ? "invisible" : ""
                    }`}
                  >
                    ←
                  </button>
                  <h2 className="text-center text-3xl font-bold sm:text-4xl">
                    {selectedYear ?? "Year"}
                  </h2>
                  <button
                    type="button"
                    disabled={
                      availableYears.length <= 1 ||
                      selectedYearIndex === -1 ||
                      selectedYearIndex >= availableYears.length - 1
                    }
                    onClick={() => {
                      if (
                        selectedYearIndex >= 0 &&
                        selectedYearIndex < availableYears.length - 1
                      ) {
                        setSelectedYear(availableYears[selectedYearIndex + 1]);
                      }
                    }}
                    className={`rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 ${
                      availableYears.length <= 1 ? "invisible" : ""
                    }`}
                  >
                    →
                  </button>
                </div>
              ) : null}

              {viewMode === "month" ? (
                <div className="mt-4 grid grid-cols-[40px_1fr_40px] items-center gap-2">
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
                  <h2 className="text-center text-3xl font-bold sm:text-4xl">
                    {selectedMonthKey
                      ? new Date(`${selectedMonthKey}-01`).toLocaleDateString(
                          undefined,
                          {
                            month: "long",
                            year: "numeric",
                          },
                        )
                      : "Month"}
                  </h2>
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

              {viewMode === "complete" ? (
                <h2 className="mt-4 text-center text-3xl font-bold sm:text-4xl">
                  Complete File
                </h2>
              ) : null}

              {selectedPeriodConstantColumns.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShowConstantColumns((v) => !v)}
                    className="mt-3 mb-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    {showConstantColumns ? "Hide" : "Show"} Timesheet Constants
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
                          {selectedPeriodConstantColumns.map((column, idx) => (
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

              <SummaryStatistics
                dateRangeLabel={activeSummary.dateRangeLabel}
                daysWithIstEntries={activeStats.daysWithIstEntries}
                totalSollHours={activeStats.totalSoll}
                totalIstHours={activeStats.totalIst}
                totalPEntries={activeStats.totalPEntries}
                kbOnlyDays={activeStats.kbOnlyDays}
                uOnlyDays={activeStats.uOnlyDays}
                homeOfficeDays={activeStats.homeOfficeDays}
                officeDays={activeStats.officeDays}
                homeOfficeSharePessimistic={
                  activeStats.homeOfficeSharePessimistic
                }
                homeOfficeShareOptimistic={activeStats.homeOfficeShareOptimistic}
                recordedHoursBreakdown={activeStats.recordedHoursBreakdown}
              />

              {viewMode === "year" ? (
                <div className="mt-4">
                  <div className="mb-3">
                    <h3 className="text-lg font-semibold">
                      Arbeitnehmer:innenveranlagung
                    </h3>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <h4 className="mb-1 text-sm font-medium text-slate-600">
                        Telearbeitstage
                      </h4>
                      <p className="text-xl font-bold text-slate-900 text-right">
                        {formatNumber(activeStats.taxmanEligibleDays)} / 100
                      </p>
                    </article>
                    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <h4 className="mb-1 inline-flex items-center gap-1 text-sm font-medium text-slate-600">
                        angerechnete Telearbeitspauschale
                        <a
                          href="https://www.arbeiterkammer.at/beratung/steuerundeinkommen/steuertipps/Steuertipps-fuers-Homeoffice.html"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-400 text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
                          aria-label="Info: Telearbeitspauschale"
                          title="Mehr Infos zur Telearbeitspauschale"
                        >
                          i
                        </a>
                      </h4>
                      <p className="text-xl font-bold text-slate-900 text-right">
                        {formatNumber(activeStats.taxmanDeductionEuros)} € / 300 €
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Calculation: min(days, 100) * 3
                      </p>
                    </article>
                  </div>
                </div>
              ) : null}

              {tableView.visibleHeaders.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  All columns are constant across rows, so the detail table is
                  hidden.
                </p>
              ) : (
                <>
                  <div className="mt-4 flex items-center gap-2">
                    <h3 className="text-lg font-semibold">Daily Records</h3>
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
                  <div
                    className="mt-2 max-h-[55vh] overflow-auto rounded-lg border border-slate-200"
                    role="region"
                    aria-label="CSV data"
                  >
                    <table className="w-full border-collapse bg-white">
                      <thead>
                        <tr>
                          {dailyRecordsTable?.headers.map((header, idx) => (
                            <th
                              key={`${header}-${idx}`}
                              className={`sticky top-0 z-20 border border-slate-200 bg-slate-50 px-2 py-2 text-left text-sm font-semibold ${
                                dailyRecordsNumericColumnIndexes.has(idx)
                                  ? "w-16 min-w-16"
                                  : ""
                              }`}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dailyRecordsTable?.rows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {row.map((cell, colIndex) => (
                              <td
                                key={`cell-${rowIndex}-${colIndex}`}
                                className={
                                  `${
                                    (dailyRecordsTable?.headers[colIndex] ?? "")
                                      .trim()
                                      .toLowerCase() === "datum" &&
                                    activeTable.rowTimelineOmitted[rowIndex]
                                      ? "border border-slate-200 px-2 py-2 text-sm align-top text-slate-500"
                                      : "border border-slate-200 px-2 py-2 text-sm align-top"
                                  } ${
                                    dailyRecordsIstIndex !== -1 &&
                                    colIndex === dailyRecordsIstIndex &&
                                    istMismatchByRow[rowIndex]
                                      ? "bg-red-100 text-red-700 font-semibold"
                                      : ""
                                  } ${
                                    dailyRecordsNumericColumnIndexes.has(colIndex)
                                      ? "w-16 min-w-16"
                                      : ""
                                  }`
                                }
                              >
                                {renderCellContent(
                                  dailyRecordsTable?.headers[colIndex] ?? "",
                                  cell,
                                  activeTable.rowHasSoll[rowIndex],
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              Load a CSV file to view complete file, year, or month data.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
