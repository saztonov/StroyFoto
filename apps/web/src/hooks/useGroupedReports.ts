import { useMemo } from "react";
import type { LocalReport, LocalProject } from "../db/dexie";

export interface WorkTypeCluster {
  workTypeKey: string;
  workTypeLabel: string;
  reports: LocalReport[];
}

export interface DayGroup {
  dateKey: string;
  displayDate: string;
  workTypeClusters: WorkTypeCluster[];
  totalReports: number;
}

export interface MonthGroup {
  monthKey: string;
  displayMonth: string;
  days: DayGroup[];
  totalReports: number;
}

export interface ProjectGroup {
  projectId: string;
  projectName: string;
  projectCode?: string;
  months: MonthGroup[];
  totalReports: number;
}

const DAY_NAMES = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTH_NAMES_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTH_NAMES_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function formatDisplayDate(dateKey: string): string {
  const d = new Date(dateKey + "T00:00:00");
  const day = d.getDate();
  const month = MONTH_NAMES_GEN[d.getMonth()];
  const dayName = DAY_NAMES[d.getDay()];
  return `${day} ${month}, ${dayName}`;
}

function formatDisplayMonth(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split("-");
  const monthIdx = parseInt(monthStr, 10) - 1;
  return `${MONTH_NAMES_NOM[monthIdx]} ${yearStr}`;
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

    // Build tree: projectId -> monthKey -> dateKey -> workTypeKey -> reports[]
    const tree = new Map<string, Map<string, Map<string, Map<string, LocalReport[]>>>>();

    for (const r of reports) {
      if (!tree.has(r.projectId)) tree.set(r.projectId, new Map());
      const monthMap = tree.get(r.projectId)!;

      const dateKey = r.dateTime.toISOString().slice(0, 10);
      const monthKey = dateKey.slice(0, 7);

      if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map());
      const dateMap = monthMap.get(monthKey)!;

      if (!dateMap.has(dateKey)) dateMap.set(dateKey, new Map());
      const wtMap = dateMap.get(dateKey)!;

      const wtKey = r.workTypes.slice().sort().join(",");
      if (!wtMap.has(wtKey)) wtMap.set(wtKey, []);
      wtMap.get(wtKey)!.push(r);
    }

    const result: ProjectGroup[] = [];

    for (const [projectId, monthMap] of tree) {
      const project = projectMap.get(projectId);
      const months: MonthGroup[] = [];

      for (const [monthKey, dateMap] of monthMap) {
        const days: DayGroup[] = [];

        for (const [dateKey, wtMap] of dateMap) {
          const workTypeClusters: WorkTypeCluster[] = [];

          for (const [wtKey, wtReports] of wtMap) {
            wtReports.sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime());
            workTypeClusters.push({
              workTypeKey: wtKey,
              workTypeLabel: wtKey.split(",").join(", "),
              reports: wtReports,
            });
          }

          workTypeClusters.sort((a, b) => a.workTypeLabel.localeCompare(b.workTypeLabel));

          const totalReports = workTypeClusters.reduce((sum, c) => sum + c.reports.length, 0);
          days.push({
            dateKey,
            displayDate: formatDisplayDate(dateKey),
            workTypeClusters,
            totalReports,
          });
        }

        days.sort((a, b) => b.dateKey.localeCompare(a.dateKey));

        const totalReports = days.reduce((sum, d) => sum + d.totalReports, 0);
        months.push({
          monthKey,
          displayMonth: formatDisplayMonth(monthKey),
          days,
          totalReports,
        });
      }

      months.sort((a, b) => b.monthKey.localeCompare(a.monthKey));

      const totalReports = months.reduce((sum, m) => sum + m.totalReports, 0);
      result.push({
        projectId,
        projectName: project?.name ?? projectId,
        projectCode: project?.code,
        months,
        totalReports,
      });
    }

    result.sort((a, b) => a.projectName.localeCompare(b.projectName));

    return result;
  }, [reports, projects]);
}
