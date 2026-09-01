import { vi } from 'vitest'

/**
 * Supabase Query Builder Mock
 * Supports chaining: from().select().eq().gte()... and resolves with data
 * No mockReturnThis - proper async thenable behavior
 */

interface QueryResult {
  data: any[] | any | null
  error: any | null
}

class QueryBuilder {
  private tableData: any[]
  private filters: Array<{ column: string; operator: string; value: any }> = []
  private promise: Promise<QueryResult>

  constructor(tableData: any[], filters: Array<{ column: string; operator: string; value: any }> = []) {
    this.tableData = tableData
    this.filters = filters
    // Build filtered data
    const filtered = this.applyFilters()
    this.promise = Promise.resolve({
      data: filtered,
      error: null,
    })
  }

  private applyFilters(): any[] {
    return this.tableData.filter((row) => {
      for (const filter of this.filters) {
        const val = row[filter.column]
        switch (filter.operator) {
          case 'eq':
            if (val !== filter.value) return false
            break
          case 'neq':
            if (val === filter.value) return false
            break
          case 'gt':
            if (val <= filter.value) return false
            break
          case 'gte':
            if (val < filter.value) return false
            break
          case 'lt':
            if (val >= filter.value) return false
            break
          case 'lte':
            if (val > filter.value) return false
            break
          case 'in':
            if (!filter.value.includes(val)) return false
            break
        }
      }
      return true
    })
  }

  // Chainable methods - return a new QueryBuilder to allow further chaining
  select(columns?: string): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters])
  }

  eq(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'eq', value }])
  }

  neq(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'neq', value }])
  }

  gt(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'gt', value }])
  }

  gte(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'gte', value }])
  }

  lt(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'lt', value }])
  }

  lte(column: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'lte', value }])
  }

  in(column: string, values: any[]): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: 'in', value: values }])
  }

  not(column: string, operator: string, value: any): QueryBuilder {
    return new QueryBuilder(this.tableData, [...this.filters, { column, operator: `not_${operator}`, value }])
  }

  // Terminal methods - resolve with data
  async order(column: string, options?: any): Promise<QueryResult> {
    return this.promise
  }

  async single(): Promise<QueryResult> {
    const filtered = this.applyFilters()
    return Promise.resolve({
      data: filtered?.[0] || null,
      error: null,
    })
  }

  // Make thenable so it can be awaited without calling a method
  then(onFulfilled?: (value: QueryResult) => any, onRejected?: (reason: any) => any) {
    return this.promise.then(onFulfilled, onRejected)
  }

  catch(onRejected?: (reason: any) => any) {
    return this.promise.catch(onRejected)
  }

  finally(onFinally?: () => void) {
    return this.promise.finally(onFinally)
  }
}

export function createMockSupabaseClient(
  dataByTable: Record<string, any> = {}
): any {
  const defaultData: Record<string, any> = {
    sumup_transactions: [],
    sumup_payouts: [],
    sumup_fee_rates_12m: [],
    ...dataByTable,
  }

  return {
    from: vi.fn((tableName: string) => {
      const tableData = defaultData[tableName] || []
      return new QueryBuilder(tableData)
    }),
  }
}
