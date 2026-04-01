'use client';

import React, { useEffect, useState } from 'react';

import { listObjects } from '@/entities/object/api/object-client';
import type { ServiceObject } from '@/entities/object/model/object.types';
import { getTimesheet, upsertTimesheetEntry } from '@/entities/timesheet/api/timesheet-client';
import type { TimesheetMonth } from '@/entities/timesheet/model/timesheet.types';
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
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const loadObjects = async (): Promise<void> => {
      try {
        const response = await listObjects();
        setObjects(response);
        setSelectedObjectId((prev) => prev || (response[0]?.id ?? ''));
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

    const loadTimesheet = async (): Promise<void> => {
      setIsLoading(true);
      setLoadError(null);

      try {
        const response = await getTimesheet({
          objectId: selectedObjectId,
          year: selectedYear,
          month: selectedMonth,
        });
        setTimesheet(response);
      } catch {
        setLoadError('Не удалось загрузить табель.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadTimesheet();
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
        <TimesheetGrid
          key={`${selectedObjectId}-${selectedYear}-${selectedMonth}`}
          timesheet={timesheet}
          onChangeEntry={async (payload) => {
            const updated = await upsertTimesheetEntry({
              objectId: selectedObjectId,
              year: selectedYear,
              month: selectedMonth,
              employeeId: payload.employeeId,
              dayOfMonth: payload.dayOfMonth,
              dayValue: payload.dayValue,
            });

            setTimesheet(updated);
          }}
        />
      ) : (
        <div className="page-card">Нет данных табеля.</div>
      )}
    </>
  );
}
