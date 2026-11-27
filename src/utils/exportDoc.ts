import { api } from '../api/client';
import { LabReportSnapshotDTO } from '../types';

export async function downloadGostTemplateDocx() {
  const defaultSnapshot: LabReportSnapshotDTO = {
    templateVersion: 'v1.0-demo',
    docLang: 'Русский',
    university: 'Учебный портал кафедры ИС (Демо-контур)',
    department: 'Кафедра «Информационные системы и программная инженерия»',
    discipline: 'Нормоконтроль академических работ',
    labNumber: '1',
    title: 'Образец оформления лабораторной работы по ГОСТ 7.32-2017 (Демо)',
    studentName: 'Фамилия Имя Отчество',
    studentGroup: 'ИС-21-2',
    teacherName: 'Преподаватель кафедры',
    cityYear: 'Шымкент, 2024',
    goal: 'Демонстрация титульного листа, полей 30/10/20/20 мм, абзацного отступа 1.25 см и кириллицы Ә, Ғ, Қ, Ң, Ө, Ұ, Ү, І.',
    tools: 'НормКонтрольЦентр · DOCX генератор',
    procedure: 'Замените текст разделов на содержание собственной работы.',
    result: 'Отчёт готов к проверке без повторной печати черновиков.',
    conclusion: 'Шаблон версии v1.0-demo.',
    sources: [
      'ГОСТ 7.32-2017. Отчёт о научно-исследовательской работе. — М., 2017.',
      'СТ РК 1048-2002. Единая система программной документации. — Астана, 2002.',
    ],
    formatting: {
      version: 'v1.0-demo',
      isDemoDefaults: true,
      pageSize: 'A4',
      marginsMm: { top: 20, right: 10, bottom: 20, left: 30 },
      fontFamily: 'Times New Roman',
      fontSizePt: 14,
      lineSpacing: 1.5,
      firstLineIndentCm: 1.25,
      hangingIndentCm: 1.0,
      showFrame: false,
      showPageNumbers: true,
    },
  };
  await api.exportLabDocx(defaultSnapshot);
}
