import { api } from '../api/client';
import { LabReportSnapshotDTO } from '../types';

export async function downloadEditableTemplateDocx() {
  const snapshot: LabReportSnapshotDTO = {
    templateVersion: 'editable-1',
    docLang: 'Русский',
    university: '[Название организации]',
    department: '[Кафедра]',
    discipline: '[Дисциплина]',
    labNumber: '[Номер]',
    title: '[Тема работы]',
    studentName: '[ФИО студента]',
    studentGroup: '[Группа]',
    teacherName: '[ФИО преподавателя]',
    cityYear: '[Город, год]',
    goal: '[Цель работы]',
    tools: '[Использованные средства]',
    procedure: '[Ход работы]',
    result: '[Результаты]',
    conclusion: '[Вывод]',
    sources: [],
    formatting: {
      version: 'editable-1', pageSize: 'A4',
      marginsMm: { top: 20, right: 10, bottom: 20, left: 30 },
      fontFamily: 'Times New Roman', fontSizePt: 14, lineSpacing: 1.5,
      firstLineIndentCm: 1.25, hangingIndentCm: 1, showFrame: false,
      showPageNumbers: true,
    },
  };
  await api.exportLabDocx(snapshot);
}
