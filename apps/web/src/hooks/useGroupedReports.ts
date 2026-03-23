import { useMemo } from "react";
import type { LocalReport, LocalProject } from "../db/dexie";

export interface DateGroup {
  dateKey: string;
  displayDate: string;
  reports: LocalReport[];
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectCode?: string;
  dates: DateGroup[];
  totalReports: number;
}

const DAY_NAMES = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH_NAMES = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function formatDisplayDate(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  const day = d.getDate();
  const month = MONTH_NAMES[d.getMonth()];
  const dayName = DAY_NAMES[d.getDay()];
  return `${day} ${month}, ${dayName}`;
}

export function useGroupedReports(
  reports: LocalReport[] | undefined,
  projects: LocalProject[] | undefined,
): ProjectGroup[] {
  return useMemo(() => {
    if (!reports || reports.length === 0) return [];

    const projectMap = new Map<string, LocalProject>();
    if (projects) {
      for (const p of projects) {
        projectMap.set(p.id, p);
        projectMap.set(p.code, p);
      }
    }

    // Group by projectId -> dateKey -> reports
    const tree = new Map<string, Map<string, LocalReport[]>>();

    for (const r of reports) {
      if (!tree.has(r.projectId)) tree.set(r.projectId, new Map());
      const dateMap = tree.get(r.projectId)!;
      const dateKey = r.dateTime.toISOString().slice(0, 10);
      if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
      dateMap.get(dateKey)!.push(r);
    }

    const result: ProjectGroup[] = [];

    for (const [projectId, dateMap] of tree) {
      const project = projectMap.get(projectId);
      const dates: DateGroup[] = [];

      for (const [dateKey, dateReports] of dateMap) {
        // Sort reports within date by dateTime descending
        dateReports.sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime());
        dates.push({
          dateKey,
          displayDate: formatDisplayDate(dateKey),
          reports: dateReports,
        });
      }

      // Sort dates descending
      dates.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

      const totalReports = dates.reduce((sum, d) => sum + d.reports.length, 0);

      result.push({
        projectId,
        projectName: project?.name ?? projectId,
        projectCode: project?.code,
        dates,
        totalReports,
      });
    }

    // Sort projects by name
    result.sort((a, b) => a.projectName.localeCompare(b.projectName));

    return result;
  }, [reports, projects]);
}
