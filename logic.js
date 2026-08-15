export function createDemoState() {
  return {
    users: [
      { id: 1, name: 'Samuel', email: 'samuel@gmail.com', password: 'Etude@2026', role: 'ADMIN', className: '', status: 'active' },
      { id: 2, name: 'M. Diallo', email: 'prof@ecole.fr', password: 'Prof@2026', role: 'PROFESSOR', className: 'Terminale A', status: 'active' },
      { id: 3, name: 'Aïcha Ndiaye', email: 'aicha@ecole.fr', password: 'Eleve@2026', role: 'STUDENT', className: 'Terminale A', status: 'active' },
      { id: 4, name: 'Kader Fall', email: 'kader@ecole.fr', password: 'Eleve@2026', role: 'STUDENT', className: 'Terminale B', status: 'active' }
    ],
    courses: [
      { id: 1, title: 'Mathématiques', className: 'Terminale A', teacherId: 2, coefficient: 1 },
      { id: 2, title: 'Physique-Chimie', className: 'Terminale A', teacherId: 2, coefficient: 1 },
      { id: 3, title: 'Histoire', className: 'Terminale B', teacherId: 2, coefficient: 1 }
    ],
    grades: [
      { id: 1, studentId: 3, courseId: 1, homework: 14, exam: 16, semester: 'Semestre 1' },
      { id: 2, studentId: 3, courseId: 2, homework: 12, exam: 15, semester: 'Semestre 1' },
      { id: 3, studentId: 4, courseId: 1, homework: 10, exam: 12, semester: 'Semestre 1' }
    ],
    announcements: [
      { id: 1, title: 'Nouveau calendrier', body: 'Le planning du trimestre est disponible.', published: true },
      { id: 2, title: 'Réunion des parents', body: 'La réunion est prévue le mardi prochain.', published: true }
    ],
    currentUser: null
  };
}

export function calculateWeightedAverage(homework, exam) {
  const hw = Number(homework) || 0;
  const ex = Number(exam) || 0;
  return Number((hw + ex).toFixed(2));
}

export function getMention(average) {
  if (average >= 16) return 'Très bien';
  if (average >= 14) return 'Bien';
  if (average >= 12) return 'Assez bien';
  if (average >= 10) return 'Passable';
  return 'Insuffisant';
}

export function buildMetrics(state) {
  const students = state.users.filter((user) => user.role === 'STUDENT');
  const professors = state.users.filter((user) => user.role === 'PROFESSOR');
  const averages = state.grades.map((grade) => {
    // support both camelCase (local) and snake_case (API) key names
    const courseId = grade.courseId ?? grade.course_id;
    const course = state.courses.find((item) => item.id === courseId);
    const average = calculateWeightedAverage(grade.homework, grade.exam);
    return { course, average };
  });
  const mean = averages.length ? (averages.reduce((sum, item) => sum + item.average, 0) / averages.length).toFixed(2) : '0.00';

  return {
    users: state.users.length,
    professors: professors.length,
    students: students.length,
    courses: state.courses.length,
    mean
  };
}
