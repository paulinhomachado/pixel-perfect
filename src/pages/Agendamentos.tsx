import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Search, Calendar, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Cliente = {
  id: string;
  nome: string;
};

type Servico = {
  id: string;
  nome: string;
  preco: number;
};

type Funcionario = {
  id: string;
  nome: string;
  cargo: string;
  ativo: boolean;
};

type Agendamento = {
  id: string;
  cliente_id: string;
  servico_id: string;
  funcionario_id: string | null;
  funcionario: string;
  data_hora: string;
  status: string;
  forma_pagamento: string | null;
  observacoes: string | null;
};

const PAYMENT_OPTIONS = [
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao_debito", label: "Cartão Débito" },
  { value: "cartao_credito", label: "Cartão de Crédito" },
  { value: "pix", label: "Pix" },
  { value: "pacote", label: "Pacote" },
] as const;

const getPaymentLabel = (value?: string | null) =>
  PAYMENT_OPTIONS.find((option) => option.value === value)?.label || "-";

const formatLocalDateTime = (data: string, hora: string) =>
  `${data}T${hora}:00`;
const nextDayStart = (data: string) => {
  const d = new Date(`${data}T00:00:00`);
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
};

export default function Agendamentos() {
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAgendamento, setEditingAgendamento] =
    useState<Agendamento | null>(null);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    clienteId: "",
    servicoId: "",
    funcionarioId: "",
    data: "",
    hora: "",
    status: "agendado" as string,
    forma_pagamento: "" as string,
    observacoes: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // Buscar agendamentos com dados dos clientes e serviços
      const { data: agendamentosData, error: agendamentosError } =
        await supabase
          .from("agendamentos")
          .select(
            `
          *,
          clientes:cliente_id(id, nome),
          servicos:servico_id(id, nome, preco)
        `,
          )
          .order("data_hora", { ascending: false });

      if (agendamentosError) throw agendamentosError;

      // Buscar clientes para o select
      const { data: clientesData, error: clientesError } = await supabase
        .from("clientes")
        .select("id, nome")
        .order("nome");

      if (clientesError) throw clientesError;

      // Buscar serviços para o select
      const { data: servicosData, error: servicosError } = await supabase
        .from("servicos")
        .select("id, nome, preco")
        .order("nome");

      if (servicosError) throw servicosError;

      // Buscar funcionários ativos para o select
      const { data: funcionariosData, error: funcionariosError } =
        await supabase
          .from("funcionarios")
          .select("id, nome, cargo, ativo")
          .eq("ativo", true)
          .order("nome");

      if (funcionariosError) throw funcionariosError;

      setAgendamentos(agendamentosData || []);
      setClientes(clientesData || []);
      setServicos(servicosData || []);
      setFuncionarios(funcionariosData || []);
    } catch (error) {
      console.error("Erro ao carregar dados:", error);
      toast.error("Erro ao carregar dados");
    } finally {
      setLoading(false);
    }
  };

  const getClienteNome = (clienteId: string) => {
    const cliente = clientes.find((c) => c.id === clienteId);
    return cliente?.nome || "Cliente não encontrado";
  };

  const getServicoNome = (servicoId: string) => {
    const servico = servicos.find((s) => s.id === servicoId);
    return servico?.nome || "Serviço não encontrado";
  };

  const getFuncionarioNome = (funcionarioId: string | null) => {
    if (!funcionarioId) return "Funcionário não definido";
    const funcionario = funcionarios.find((f) => f.id === funcionarioId);
    return funcionario?.nome || "Funcionário não encontrado";
  };

  const filteredAgendamentos = agendamentos.filter((agendamento) => {
    const clienteNome = getClienteNome(agendamento.cliente_id).toLowerCase();
    const servicoNome = getServicoNome(agendamento.servico_id).toLowerCase();
    const funcionarioNome = getFuncionarioNome(
      agendamento.funcionario_id,
    ).toLowerCase();
    const searchLower = searchTerm.toLowerCase();

    return (
      clienteNome.includes(searchLower) ||
      servicoNome.includes(searchLower) ||
      funcionarioNome.includes(searchLower)
    );
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (formData.status === "concluido" && !formData.forma_pagamento) {
        toast.error("Selecione a forma de pagamento para status concluído.");
        return;
      }

      // Criar data/hora no timezone local do Brasil (UTC-3)
      const dataHora = formatLocalDateTime(formData.data, formData.hora);

      // Buscar tempo médio do serviço selecionado
      const { data: servicoData } = await supabase
        .from("servicos")
        .select("tempo_medio")
        .eq("id", formData.servicoId)
        .single();

      const tempoServico = servicoData?.tempo_medio || 30;
      const dataHoraInicio = new Date(dataHora);
      const dataHoraFim = new Date(
        dataHoraInicio.getTime() + tempoServico * 60000,
      );

      // Verificar se já existe agendamento do funcionário nesse horário
      const proximoDiaIso = nextDayStart(formData.data);

      const { data: agendamentosConflito } = await supabase
        .from("agendamentos")
        .select("id, data_hora, servico_id, servicos(tempo_medio)")
        .eq("funcionario_id", formData.funcionarioId)
        .eq("status", "agendado")
        .gte("data_hora", formData.data + "T00:00:00")
        .lt("data_hora", proximoDiaIso);

      // Verificar sobreposição de horários
      if (agendamentosConflito) {
        for (const ag of agendamentosConflito) {
          // Pular o próprio agendamento que está sendo editado
          if (editingAgendamento && ag.id === editingAgendamento.id) continue;

          const agInicio = new Date(ag.data_hora);
          const agTempoServico = (ag.servicos as any)?.tempo_medio || 30;
          const agFim = new Date(agInicio.getTime() + agTempoServico * 60000);

          // Verificar se há sobreposição
          if (
            (dataHoraInicio >= agInicio && dataHoraInicio < agFim) ||
            (dataHoraFim > agInicio && dataHoraFim <= agFim) ||
            (dataHoraInicio <= agInicio && dataHoraFim >= agFim)
          ) {
            toast.error(
              `Este horário conflita com outro agendamento às ${agInicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
            );
            return;
          }
        }
      }

      if (editingAgendamento) {
        // Editar agendamento existente
        const { error } = await supabase
          .from("agendamentos")
          .update({
            cliente_id: formData.clienteId,
            servico_id: formData.servicoId,
            funcionario_id: formData.funcionarioId,
            funcionario: getFuncionarioNome(formData.funcionarioId),
            data_hora: dataHora,
            status: formData.status,
            forma_pagamento:
              formData.status === "concluido" ? formData.forma_pagamento : null,
            observacoes: formData.observacoes || null,
          })
          .eq("id", editingAgendamento.id);

        if (error) throw error;
        toast.success("Agendamento atualizado com sucesso!");
      } else {
        // Adicionar novo agendamento
        const { error } = await supabase.from("agendamentos").insert([
          {
            cliente_id: formData.clienteId,
            servico_id: formData.servicoId,
            funcionario_id: formData.funcionarioId,
            funcionario: getFuncionarioNome(formData.funcionarioId),
            data_hora: dataHora,
            status: formData.status,
            forma_pagamento:
              formData.status === "concluido" ? formData.forma_pagamento : null,
            observacoes: formData.observacoes || null,
          },
        ]);

        if (error) throw error;
        toast.success("Agendamento criado com sucesso!");
      }

      fetchData(); // Recarregar dados
      resetForm();
    } catch (error) {
      console.error("Erro ao salvar agendamento:", error);
      toast.error("Erro ao salvar agendamento");
    }
  };

  const handleEdit = (agendamento: Agendamento) => {
    setEditingAgendamento(agendamento);
    // Converter de UTC para timezone local do Brasil
    const dataHoraUTC = new Date(agendamento.data_hora);
    const ano = dataHoraUTC.getFullYear();
    const mes = String(dataHoraUTC.getMonth() + 1).padStart(2, "0");
    const dia = String(dataHoraUTC.getDate()).padStart(2, "0");
    const hora = String(dataHoraUTC.getHours()).padStart(2, "0");
    const minuto = String(dataHoraUTC.getMinutes()).padStart(2, "0");

    setFormData({
      clienteId: agendamento.cliente_id,
      servicoId: agendamento.servico_id,
      funcionarioId: agendamento.funcionario_id || "",
      data: `${ano}-${mes}-${dia}`,
      hora: `${hora}:${minuto}`,
      status: agendamento.status,
      forma_pagamento: agendamento.forma_pagamento || "",
      observacoes: agendamento.observacoes || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase
        .from("agendamentos")
        .delete()
        .eq("id", id);

      if (error) throw error;

      setAgendamentos((prev) =>
        prev.filter((agendamento) => agendamento.id !== id),
      );
      toast.success("Agendamento removido com sucesso!");
    } catch (error) {
      console.error("Erro ao remover agendamento:", error);
      toast.error("Erro ao remover agendamento");
    }
  };

  const resetForm = () => {
    setFormData({
      clienteId: "",
      servicoId: "",
      funcionarioId: "",
      data: "",
      hora: "",
      status: "agendado",
      forma_pagamento: "",
      observacoes: "",
    });
    setEditingAgendamento(null);
    setIsDialogOpen(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "agendado":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            Agendado
          </Badge>
        );
      case "concluido":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            Concluído
          </Badge>
        );
      case "cancelado":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            Cancelado
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-1 md:mb-2">
            Agendamentos
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Gerencie todos os agendamentos!
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[hsl(340,80%,55%)] hover:bg-[hsl(340,80%,45%)] text-white shadow-violet transition-smooth w-full md:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Novo Agendamento
            </Button>
          </DialogTrigger>
          <DialogContent className="gradient-card border-border w-[95vw] max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-foreground">
                {editingAgendamento ? "Editar Agendamento" : "Novo Agendamento"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="clienteId" className="text-foreground">
                    Cliente
                  </Label>
                  <Select
                    value={formData.clienteId}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, clienteId: value }))
                    }
                  >
                    <SelectTrigger className="bg-input border-border text-foreground">
                      <SelectValue placeholder="Selecione um cliente" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {clientes.map((cliente) => (
                        <SelectItem
                          key={cliente.id}
                          value={cliente.id}
                          className="text-foreground"
                        >
                          {cliente.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="servicoId" className="text-foreground">
                    Serviço
                  </Label>
                  <Select
                    value={formData.servicoId}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, servicoId: value }))
                    }
                  >
                    <SelectTrigger className="bg-input border-border text-foreground">
                      <SelectValue placeholder="Selecione um serviço" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {servicos.map((servico) => (
                        <SelectItem
                          key={servico.id}
                          value={servico.id}
                          className="text-foreground"
                        >
                          {servico.nome} - R$ {Number(servico.preco).toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.status === "concluido" && (
                <div>
                  <Label htmlFor="forma_pagamento" className="text-foreground">
                    Forma de Pagamento
                  </Label>
                  <Select
                    value={formData.forma_pagamento}
                    onValueChange={(value) =>
                      setFormData((prev) => ({
                        ...prev,
                        forma_pagamento: value,
                      }))
                    }
                  >
                    <SelectTrigger className="bg-input border-border text-foreground">
                      <SelectValue placeholder="Selecione a forma de pagamento" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {PAYMENT_OPTIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={option.value}
                          className="text-foreground"
                        >
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="funcionarioId" className="text-foreground">
                    Funcionário
                  </Label>
                  <Select
                    value={formData.funcionarioId}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, funcionarioId: value }))
                    }
                  >
                    <SelectTrigger className="bg-input border-border text-foreground">
                      <SelectValue placeholder="Selecione um funcionário" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {funcionarios.map((funcionario) => (
                        <SelectItem
                          key={funcionario.id}
                          value={funcionario.id}
                          className="text-foreground"
                        >
                          {funcionario.nome} ({funcionario.cargo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="status" className="text-foreground">
                    Status
                  </Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) =>
                      setFormData((prev) => ({ ...prev, status: value as any }))
                    }
                  >
                    <SelectTrigger className="bg-input border-border text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="agendado" className="text-foreground">
                        Agendado
                      </SelectItem>
                      <SelectItem value="concluido" className="text-foreground">
                        Concluído
                      </SelectItem>
                      <SelectItem value="cancelado" className="text-foreground">
                        Cancelado
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="data" className="text-foreground">
                    Data
                  </Label>
                  <Input
                    id="data"
                    type="date"
                    value={formData.data}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, data: e.target.value }))
                    }
                    className="bg-input border-border text-foreground"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="hora" className="text-foreground">
                    Hora
                  </Label>
                  <Input
                    id="hora"
                    type="time"
                    value={formData.hora}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, hora: e.target.value }))
                    }
                    className="bg-input border-border text-foreground"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="observacoes" className="text-foreground">
                  Observações
                </Label>
                <Textarea
                  id="observacoes"
                  value={formData.observacoes}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      observacoes: e.target.value,
                    }))
                  }
                  className="bg-input border-border text-foreground"
                  placeholder="Observações sobre o agendamento..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  type="submit"
                  className="flex-1 bg-[hsl(340,80%,55%)] hover:bg-[hsl(340,80%,45%)] text-white"
                >
                  {editingAgendamento ? "Atualizar" : "Agendar"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  className="flex-1"
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="gradient-card border-border shadow-elevated">
        <CardHeader className="pb-3 md:pb-6">
          <div className="flex flex-col gap-3 md:gap-4 md:flex-row md:items-center md:justify-between">
            <CardTitle className="text-foreground flex items-center gap-2 text-base md:text-lg">
              <Calendar className="w-5 h-5 text-primary" />
              Lista de Agendamentos
            </CardTitle>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar agendamentos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10 w-full md:w-72 bg-input border-border" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Mobile card view */}
          <div className="space-y-3 md:hidden">
            {filteredAgendamentos.map((agendamento) => (
              <div key={agendamento.id} className="p-4 rounded-lg bg-secondary/30 border border-border space-y-2">
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="font-medium text-foreground">{getClienteNome(agendamento.cliente_id)}</p>
                    <p className="text-sm text-muted-foreground">{getServicoNome(agendamento.servico_id)}</p>
                    <p className="text-sm text-muted-foreground">{getFuncionarioNome(agendamento.funcionario_id)}</p>
                  </div>
                  <div className="flex gap-2 ml-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(agendamento)} className="h-8 w-8 p-0">
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(agendamento.id)} className="h-8 w-8 p-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    {new Date(agendamento.data_hora).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {new Date(agendamento.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {getStatusBadge(agendamento.status)}
                  <span className="text-muted-foreground">{getPaymentLabel(agendamento.forma_pagamento)}</span>
                </div>
                {agendamento.observacoes && (
                  <p className="text-xs text-muted-foreground truncate">Obs: {agendamento.observacoes}</p>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Cliente</TableHead>
                  <TableHead className="text-muted-foreground">Serviço</TableHead>
                  <TableHead className="text-muted-foreground">Funcionário</TableHead>
                  <TableHead className="text-muted-foreground">Data/Hora</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground">Pagamento</TableHead>
                  <TableHead className="text-muted-foreground">Observações</TableHead>
                  <TableHead className="text-muted-foreground text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAgendamentos.map((agendamento) => (
                  <TableRow key={agendamento.id} className="border-border hover:bg-secondary/20 transition-smooth">
                    <TableCell className="font-medium text-foreground">{getClienteNome(agendamento.cliente_id)}</TableCell>
                    <TableCell className="text-foreground">{getServicoNome(agendamento.servico_id)}</TableCell>
                    <TableCell className="text-foreground">{getFuncionarioNome(agendamento.funcionario_id)}</TableCell>
                    <TableCell className="text-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        {new Date(agendamento.data_hora).toLocaleDateString("pt-BR")}
                        <Clock className="w-4 h-4 text-muted-foreground ml-2" />
                        {new Date(agendamento.data_hora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(agendamento.status)}</TableCell>
                    <TableCell className="text-foreground">{getPaymentLabel(agendamento.forma_pagamento)}</TableCell>
                    <TableCell className="text-foreground max-w-32 truncate">{agendamento.observacoes || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(agendamento)} className="h-8 w-8 p-0"><Pencil className="w-4 h-4" /></Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDelete(agendamento.id)} className="h-8 w-8 p-0"><Trash2 className="w-4 h-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
