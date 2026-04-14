'use client';

import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import {
  getTimesheet,
  getTimesheetCorrections,
  upsertTimesheetEntry,
} from '@/entities/timesheet/api/timesheet-client';
import type {
  TimesheetCorrectionItem,
  TimesheetMonth,
} from '@/entities/timesheet/model/timesheet.types';
import { TimesheetCorrectionsPanel } from '@/features/timesheet-corrections/ui/timesheet-corrections-panel';
import { TimesheetFilters } from '@/features/timesheet-filters/ui/timesheet-filters';
import { TimesheetGrid } from '@/features/timesheet-grid/ui/timesheet-grid';
import { TimesheetLegend } from '@/features/timesheet-legend/ui/timesheet-legend';
import { PageTitle } from '@/shared/ui/page-title/page-title';

export default function TimesheetPage(): React.JSX.Element {
  const [objects, setObjects] = useState<ServiceObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState('');
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedMonth, setSelectedMonth] = useState(4);

  const [timesheet, setTimesheet] = useState<TimesheetMonth | null>(null);
  const [corrections, setCorrections] = useState<TimesheetCorrectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const loadObjects = async (): Promise<void> => {
      try {
        const response = await listObjects();
        setObjects(response);
        setSelectedObjectId((prev) => prev || response[0]?.id || '');
      } catch {
        setLoadError('Не удалось загрузить список объектов.');
      }
    };

    void loadObjects();
  }, []);

  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }

    const loadTimesheetData = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const [timesheetResponse, correctionsResponse] = await Promise.all([
          getTimesheet({
            objectId: selectedObjectId,
            year: selectedYear,
            month: selectedMonth,
          }),
          getTimesheetCorrections({
            objectId: selectedObjectId,
            year: selectedYear,
            month: selectedMonth,
          }),
        ]);

        setTimesheet(timesheetResponse);
        setCorrections(correctionsResponse);
      } catch {
        setLoadError('Не удалось загрузить табель.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTimesheetData();
  }, [selectedObjectId, selectedYear, selectedMonth]);

  return (
    <>
      <PageTitle title="Табель" />

      <TimesheetFilters
        objects={objects}
        selectedObjectId={selectedObjectId}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onObjectChange={setSelectedObjectId}
        onYearChange={setSelectedYear}
        onMonthChange={setSelectedMonth}
      />

      <TimesheetLegend />

      {isLoading ? (
        <div className="page-card">Загрузка...</div>
      ) : loadError ? (
        <div className="page-card" style={{ color: '#b91c1c' }}>
          {loadError}
        </div>
      ) : timesheet ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <TimesheetGrid
            key={`${selectedObjectId}-${selectedYear}-${selectedMonth}`}
            timesheet={timesheet}
            onChangeEntry={async (payload) => {
              const updatedTimesheet = await upsertTimesheetEntry({
                objectId: selectedObjectId,
                year: selectedYear,
                month: selectedMonth,
                employeeId: payload.employeeId,
                dayOfMonth: payload.dayOfMonth,
                dayValue: payload.dayValue,
                comment: payload.comment,
              });

              const updatedCorrections = await getTimesheetCorrections({
                objectId: selectedObjectId,
                year: selectedYear,
                month: selectedMonth,
              });

              setTimesheet(updatedTimesheet);
              setCorrections(updatedCorrections);
            }}
          />

          <TimesheetCorrectionsPanel items={corrections} />
        </div>
      ) : (
        <div className="page-card">Нет данных табеля.</div>
      )}
    </>
  );
}
