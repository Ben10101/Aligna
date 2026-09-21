import { Component } from 'react'

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <section className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-7 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-rose-700">Falha ao carregar a tela</p>
        <h1 className="mt-2 text-xl font-bold text-slate-950">Não foi possível abrir esta página.</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Atualize a página. Se o erro persistir, envie esta mensagem ao suporte:</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">{this.state.error.message}</pre>
        <button type="button" onClick={() => window.location.assign('/projects')} className="dashboard-button-primary mt-6">Voltar para projetos</button>
      </section>
    </main>
  }
}
