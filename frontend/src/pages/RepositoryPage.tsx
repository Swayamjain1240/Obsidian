import { useNavigate } from 'react-router-dom';

import { selectRepository, type RepositorySummary } from '../api';
import { RepositoryPicker } from '../components/RepositoryPicker';

export function RepositoryPage() {
  const navigate = useNavigate();

  const select = async (repository: RepositorySummary) => {
    await selectRepository(repository);
    navigate('/project/detect', { state: { repository } });
  };

  return (
    <section className="page-layout repository-layout" aria-labelledby="repository-page-title">
      <div className="page-intro">
        <span className="eyebrow">Step 1 of 9</span>
        <h1 id="repository-page-title">Choose a repository.</h1>
        <p className="muted">Only repositories returned by your GitHub session are selectable. Results are paginated so the workspace stays focused.</p>
      </div>
      <RepositoryPicker onSelect={select} />
    </section>
  );
}
