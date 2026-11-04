import SwiftUI
import SwiftData
import MapKit
import RoadTrackerCore

/// Дом, Работа и другие частые места. Геозоны по ним включаются на этапе 3.
struct PlacesView: View {
    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<PlaceRecord> { $0.deletedAt == nil }, sort: \PlaceRecord.name)
    private var places: [PlaceRecord]

    private func place(_ kind: PlaceKind) -> PlaceRecord? { places.first { $0.kind == kind } }

    var body: some View {
        List {
            Section {
                ForEach([PlaceKind.home, .work], id: \.self) { kind in
                    if let p = place(kind) {
                        NavigationLink { PlaceEditorView(place: p) } label: { PlaceRow(place: p) }
                    } else {
                        NavigationLink { PlaceEditorView(kind: kind) } label: {
                            Label("Указать: \(kind.title)", systemImage: kind.symbolName)
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
            } footer: {
                Text("По этим местам приложение будет предлагать начать и завершить поездку.")
            }
            Section("Другие места") {
                ForEach(places.filter { $0.kind == .other }) { p in
                    NavigationLink { PlaceEditorView(place: p) } label: { PlaceRow(place: p) }
                }
                .onDelete { offsets in
                    let others = places.filter { $0.kind == .other }
                    for i in offsets { try? store?.delete(others[i]) }
                }
                NavigationLink { PlaceEditorView(kind: .other) } label: {
                    Label("Добавить место", systemImage: "plus.circle.fill")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Места")
    }
}

private struct PlaceRow: View {
    let place: PlaceRecord
    var body: some View {
        HStack {
            Image(systemName: place.kind.symbolName).foregroundStyle(Theme.accent).frame(width: 28)
            VStack(alignment: .leading) {
                Text(place.name)
                Text(place.address ?? String(format: "%.5f, %.5f", place.latitude, place.longitude))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Text("\(place.radius) м").font(.caption).foregroundStyle(Theme.textSecondary)
        }
    }
}

/// Выбор точки на карте: метка всегда в центре, двигается карта. Поиск по адресу — через MapKit.
struct PlaceEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tripStore) private var store
    @State private var draft: PlaceDraft
    @State private var camera: MapCameraPosition
    @State private var query = ""
    @State private var searching = false
    @State private var message: String?
    private let isNew: Bool

    init(place: PlaceRecord) {
        let d = PlaceDraft(place)
        _draft = State(initialValue: d)
        _camera = State(initialValue: Self.position(for: d))
        isNew = false
    }

    init(kind: PlaceKind) {
        let d = PlaceDraft(kind: kind)
        _draft = State(initialValue: d)
        _camera = State(initialValue: Self.position(for: d))
        isNew = true
    }

    private static func position(for d: PlaceDraft) -> MapCameraPosition {
        .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: d.latitude, longitude: d.longitude),
                                   latitudinalMeters: Double(d.radius) * 6, longitudinalMeters: Double(d.radius) * 6))
    }

    private var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: draft.latitude, longitude: draft.longitude)
    }

    var body: some View {
        Form {
            Section {
                ZStack {
                    Map(position: $camera) {
                        MapCircle(center: center, radius: CLLocationDistance(draft.radius))
                            .foregroundStyle(Theme.accent.opacity(0.18))
                            .stroke(Theme.accent, lineWidth: 1.5)
                    }
                    .onMapCameraChange(frequency: .onEnd) { context in
                        draft.latitude = context.region.center.latitude
                        draft.longitude = context.region.center.longitude
                    }
                    Image(systemName: "mappin")
                        .font(.title)
                        .foregroundStyle(Theme.accent)
                        .offset(y: -14)
                        .allowsHitTesting(false)
                }
                .frame(height: 260)
                .listRowInsets(EdgeInsets())

                HStack {
                    TextField("Найти адрес", text: $query)
                        .submitLabel(.search)
                        .onSubmit { Task { await search() } }
                    if searching { ProgressView() }
                }
            } footer: {
                Text("Двигайте карту, чтобы поставить метку. Координаты: \(String(format: "%.5f, %.5f", draft.latitude, draft.longitude))")
            }

            Section {
                Picker("Тип", selection: $draft.kind) {
                    ForEach(PlaceKind.allCases, id: \.self) { Label($0.title, systemImage: $0.symbolName).tag($0) }
                }
                TextField("Название", text: $draft.name)
                TextField("Адрес", text: $draft.address)
            }

            Section {
                Stepper("Радиус геозоны: \(draft.radius) м", value: $draft.radius, in: 100...2000, step: 50)
            } footer: {
                Text("iOS определяет вход и выход с точностью около 100–200 м, поэтому радиус меньше 100 м не используется.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(isNew ? "Новое место" : draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Сохранить") {
                    do {
                        try store?.save(draft)
                        dismiss()
                    } catch {
                        message = error.localizedDescription
                    }
                }
                .disabled(!draft.isValid)
            }
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        searching = true
        defer { searching = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        request.region = MKCoordinateRegion(center: center, latitudinalMeters: 50_000, longitudinalMeters: 50_000)
        do {
            let response = try await MKLocalSearch(request: request).start()
            guard let item = response.mapItems.first else {
                message = String(localized: "Ничего не найдено.")
                return
            }
            let coordinate = item.placemark.coordinate
            draft.latitude = coordinate.latitude
            draft.longitude = coordinate.longitude
            if draft.address.isEmpty || !isNew { draft.address = item.placemark.title ?? text }
            if draft.name.isEmpty { draft.name = item.name ?? text }
            camera = Self.position(for: draft)
        } catch {
            message = String(localized: "Поиск недоступен: \(error.localizedDescription)")
        }
    }
}
